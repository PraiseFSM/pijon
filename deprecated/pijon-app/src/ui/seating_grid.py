from PyQt6.QtWidgets import QWidget, QMenu, QMessageBox
from PyQt6.QtCore import Qt, QRect, QPoint, pyqtSignal
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QPixmap, QCursor, QFont
from typing import Dict, List, Optional, Set

from src.models.student import Student
from src.models.furniture import Furniture
from src.models.classroom import Classroom
from src.models.preference import PreferenceTargetType
from src.models.preference import Preference
from src.algorithm.seat_graph import SeatGraph
from src.utils import mirror_student_preference
from src.ui import theme


class SeatingGrid(QWidget):
    """Grid canvas showing classroom furniture with student assignment overlays."""

    marker_mode_exited    = pyqtSignal()
    student_info_requested = pyqtSignal(object)  # emits Student

    def __init__(self, grid_width: int = 20, grid_height: int = 15, cell_size: int = 40):
        super().__init__()
        self.grid_width  = grid_width
        self.grid_height = grid_height
        self.cell_size   = cell_size

        self.furniture_list: List[Furniture]    = []
        self.assignments:    Dict[str, Student] = {}

        self.marker_mode_active                     = False
        self.marker_mode_weight: float              = -1.0
        self.marker_selected_student: Optional[Student] = None

        self.locked_seats:  Set[str] = set()
        self.fixture_seats: Set[str] = set()

        self.dragging_from:    Optional[str]     = None
        self.drag_student:     Optional[Student]  = None
        self.drag_cursor_pos:  Optional[QPoint]   = None
        self.drag_hover_fid:   Optional[str]      = None

        self.violation_mode:       bool              = False
        self.current_seat_graph:   Optional[SeatGraph] = None
        self.neighbor_preview_fid: Optional[str]     = None

        self.update_size()

    # ── mode setters ──────────────────────────────────────────────────────────

    def set_marker_mode(self, active: bool, weight: float = -1.0):
        self.marker_mode_active  = active
        self.marker_mode_weight  = weight
        self.marker_selected_student = None
        cursor = Qt.CursorShape.CrossCursor if active else Qt.CursorShape.ArrowCursor
        self.setCursor(QCursor(cursor))
        self.update()

    def set_violation_mode(self, active: bool):
        self.violation_mode = active
        self.update()

    def set_seat_graph(self, seat_graph: SeatGraph):
        self.current_seat_graph = seat_graph
        self.update()

    def clear_neighbor_preview(self):
        self.neighbor_preview_fid = None
        self.update()

    # ── geometry ─────────────────────────────────────────────────────────────

    def update_size(self):
        self.setMinimumSize(self.grid_width * self.cell_size,
                            self.grid_height * self.cell_size)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    # ── classroom/data management ─────────────────────────────────────────────

    def set_classroom(self, classroom: Classroom):
        self.furniture_list = classroom.furniture
        self.grid_width     = classroom.grid_width
        self.grid_height    = classroom.grid_height
        self.assignments.clear()
        self.locked_seats.clear()
        self.fixture_seats.clear()
        self.current_seat_graph  = None
        self.neighbor_preview_fid = None
        self.update_size()
        self.update()

    def apply_fixtures(self, fixtures: Dict[str, Student]):
        """Install fixture sentinel students. Called immediately after set_classroom."""
        for fid in self.fixture_seats:
            self.assignments.pop(fid, None)
        self.fixture_seats = set(fixtures.keys())
        self.assignments.update(fixtures)
        self.update()

    def apply_assignments(self, assignments: Dict[str, Student]):
        """Apply allocator output. Fixture assignments are preserved."""
        preserved = {fid: s for fid, s in self.assignments.items()
                     if fid in self.fixture_seats}
        self.assignments = dict(assignments)
        self.assignments.update(preserved)
        self.update()

    def clear_assignments(self):
        self.assignments  = {fid: s for fid, s in self.assignments.items()
                             if fid in self.fixture_seats}
        self.locked_seats.clear()
        self.update()

    def get_assignments(self) -> Dict[str, Student]:
        return self.assignments

    # ── violation helpers ─────────────────────────────────────────────────────

    def _build_id_map(self) -> Dict[str, str]:
        return {s.id: f for f, s in self.assignments.items()
                if f not in self.fixture_seats}

    def _has_violation(self, student: Student, fid: str,
                       id_map: Dict[str, str]) -> bool:
        if not self.current_seat_graph:
            return False
        for pref in student.preferences:
            if pref.weight >= 0:
                continue
            if pref.target_type == PreferenceTargetType.STUDENT:
                target_fid = id_map.get(pref.target_id)
                if (target_fid and target_fid != fid and
                        self.current_seat_graph.are_neighbors(fid, target_fid)):
                    return True
            elif pref.target_type == PreferenceTargetType.FURNITURE:
                fix_fid = self.current_seat_graph.fixture_id_to_fid.get(pref.target_id)
                if fix_fid and self.current_seat_graph.are_neighbors(fid, fix_fid):
                    return True
        return False

    # ── keyboard ──────────────────────────────────────────────────────────────

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape and self.marker_mode_active:
            self.set_marker_mode(False)
            self.marker_mode_exited.emit()

    # ── mouse ─────────────────────────────────────────────────────────────────

    def mousePressEvent(self, event):
        if self.marker_mode_active:
            self._handle_marker_click(event)
        elif event.button() == Qt.MouseButton.LeftButton:
            self._start_drag(event)

    def _handle_marker_click(self, event):
        gx = event.position().toPoint().x() // self.cell_size
        gy = event.position().toPoint().y() // self.cell_size

        clicked_furniture = next(
            (f for f in self.furniture_list if (gx, gy) in f.get_occupied_cells()),
            None,
        )
        if not clicked_furniture:
            return

        clicked_student = self.assignments.get(clicked_furniture.furniture_id)
        if not clicked_student:
            QMessageBox.warning(self, "No Student", "No student assigned to this desk.")
            return

        if not self.marker_selected_student:
            self.marker_selected_student = clicked_student
            self.update()
        else:
            if clicked_student.id == self.marker_selected_student.id:
                QMessageBox.information(self, "Same Student",
                                        "Cannot create preference with self!")
                return
            pref = Preference(PreferenceTargetType.STUDENT,
                              clicked_student.id, self.marker_mode_weight)
            self.marker_selected_student.add_preference(pref)
            mirror_student_preference(self.marker_selected_student, clicked_student,
                                      self.marker_mode_weight)
            self.marker_selected_student = None
            self.update()

    def _start_drag(self, event):
        gx = event.position().toPoint().x() // self.cell_size
        gy = event.position().toPoint().y() // self.cell_size
        for furniture in self.furniture_list:
            if (gx, gy) in furniture.get_occupied_cells():
                fid = furniture.furniture_id
                student = self.assignments.get(fid)
                if student and fid not in self.fixture_seats:
                    self.dragging_from   = fid
                    self.drag_student    = student
                    self.drag_cursor_pos = event.position().toPoint()
                    self.drag_hover_fid  = fid
                    self.update()
                break

    def mouseMoveEvent(self, event):
        if not self.dragging_from:
            return
        self.drag_cursor_pos = event.position().toPoint()
        gx = self.drag_cursor_pos.x() // self.cell_size
        gy = self.drag_cursor_pos.y() // self.cell_size
        self.drag_hover_fid = next(
            (f.furniture_id for f in self.furniture_list
             if (gx, gy) in f.get_occupied_cells()
             and f.furniture_id not in self.fixture_seats),
            None,
        )
        self.update()

    def mouseReleaseEvent(self, event):
        if event.button() != Qt.MouseButton.LeftButton or not self.dragging_from:
            return
        gx = event.position().toPoint().x() // self.cell_size
        gy = event.position().toPoint().y() // self.cell_size
        target_fid = next(
            (f.furniture_id for f in self.furniture_list
             if (gx, gy) in f.get_occupied_cells()
             and f.furniture_id not in self.fixture_seats),
            None,
        )
        if target_fid and target_fid != self.dragging_from:
            source_student = self.drag_student
            target_student = self.assignments.get(target_fid)
            self.assignments[target_fid] = source_student
            if target_student:
                self.assignments[self.dragging_from] = target_student
            else:
                self.assignments.pop(self.dragging_from, None)
            self.locked_seats.discard(self.dragging_from)
            self.locked_seats.discard(target_fid)
        self.dragging_from   = None
        self.drag_student    = None
        self.drag_cursor_pos = None
        self.drag_hover_fid  = None
        self.update()

    # ── context menu (right-click) ────────────────────────────────────────────

    def contextMenuEvent(self, event):
        gx = event.pos().x() // self.cell_size
        gy = event.pos().y() // self.cell_size

        clicked_furniture = next(
            (f for f in self.furniture_list if (gx, gy) in f.get_occupied_cells()),
            None,
        )

        if not clicked_furniture:
            if self.neighbor_preview_fid is not None:
                self.neighbor_preview_fid = None
                self.update()
            return

        fid = clicked_furniture.furniture_id

        if self.current_seat_graph:
            self.neighbor_preview_fid = None if fid == self.neighbor_preview_fid else fid
            self.update()

        student = self.assignments.get(fid)
        if not student:
            return

        menu = QMenu(self)

        header = menu.addAction(student.name)
        header.setEnabled(False)
        bold = QFont()
        bold.setBold(True)
        header.setFont(bold)
        menu.addSeparator()

        if fid in self.fixture_seats:
            lbl = menu.addAction("Fixture — not a student seat")
            lbl.setEnabled(False)
        else:
            if self.current_seat_graph:
                nbr_fids  = self.current_seat_graph.neighbors(fid)
                nbr_count = len(nbr_fids)
                nbr_lbl   = menu.addAction(
                    f"{nbr_count} neighboring desk{'s' if nbr_count != 1 else ''}"
                )
                nbr_lbl.setEnabled(False)
                menu.addSeparator()

            pref_count = len(student.preferences)
            pref_text  = (f"Show Preferences ({pref_count})"
                          if pref_count else "No Preferences")
            prefs_action = menu.addAction(pref_text)
            prefs_action.triggered.connect(
                lambda checked=False, s=student: self.student_info_requested.emit(s)
            )
            menu.addSeparator()

            if fid in self.locked_seats:
                act = menu.addAction("Unlock from desk")
                act.triggered.connect(lambda: self._unlock_seat(fid))
            else:
                act = menu.addAction("Lock to this desk")
                act.triggered.connect(lambda: self._lock_seat(fid))

        menu.exec(event.globalPos())

    def _lock_seat(self, fid: str):
        self.locked_seats.add(fid)
        self.update()

    def _unlock_seat(self, fid: str):
        self.locked_seats.discard(fid)
        self.update()

    # ── painting ──────────────────────────────────────────────────────────────

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor(theme.GRID_BG))

        painter.setPen(QPen(QColor(theme.GRID_LINE), 1))
        for x in range(self.grid_width + 1):
            xp = x * self.cell_size
            painter.drawLine(xp, 0, xp, self.grid_height * self.cell_size)
        for y in range(self.grid_height + 1):
            yp = y * self.cell_size
            painter.drawLine(0, yp, self.grid_width * self.cell_size, yp)

        violation_id_map = self._build_id_map() if self.violation_mode else {}
        neighbor_set: Set[str] = set()
        if self.neighbor_preview_fid and self.current_seat_graph:
            neighbor_set = set(self.current_seat_graph.neighbors(self.neighbor_preview_fid))

        for furniture in self.furniture_list:
            self._draw_furniture(painter, furniture, violation_id_map, neighbor_set)

        if self.drag_student and self.drag_cursor_pos:
            self._draw_drag_preview(painter)

    def _draw_drag_preview(self, painter: QPainter):
        label = self.drag_student.name
        w, h  = 80, 28
        rect  = QRect(self.drag_cursor_pos.x() - w // 2,
                      self.drag_cursor_pos.y() - h // 2, w, h)
        painter.setBrush(QBrush(QColor(theme.DRAG_PREVIEW_BG)))
        painter.setPen(QPen(QColor(theme.DRAG_PREVIEW_BORDER), 2))
        painter.drawRoundedRect(rect, 4, 4)
        painter.setPen(QPen(QColor(theme.DRAG_PREVIEW_TEXT)))
        font = painter.font()
        font.setPointSize(8)
        font.setBold(True)
        painter.setFont(font)
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, label)

    def _draw_furniture(self, painter: QPainter, furniture: Furniture,
                        violation_id_map: Dict[str, str],
                        neighbor_set: Set[str]):
        x, y = furniture.position
        frect = QRect(x * self.cell_size + 2, y * self.cell_size + 2,
                      furniture.width  * self.cell_size - 4,
                      furniture.height * self.cell_size - 4)

        if furniture.image_path:
            px = QPixmap(str(furniture.image_path))
            if not px.isNull():
                scaled = px.scaled(frect.size(),
                                   Qt.AspectRatioMode.KeepAspectRatio,
                                   Qt.TransformationMode.SmoothTransformation)
                painter.drawPixmap(
                    frect.x() + (frect.width()  - scaled.width())  // 2,
                    frect.y() + (frect.height() - scaled.height()) // 2,
                    scaled,
                )

        fid        = furniture.furniture_id
        student    = self.assignments.get(fid)
        is_fixture = fid in self.fixture_seats
        is_locked  = fid in self.locked_seats
        is_source  = fid == self.neighbor_preview_fid
        is_nbr     = fid in neighbor_set
        is_dragging_from = fid == self.dragging_from
        is_drop_target   = (self.dragging_from is not None and
                            fid == self.drag_hover_fid and
                            fid != self.dragging_from)
        neighbor_mode = bool(self.neighbor_preview_fid)

        is_selected = (not is_fixture and self.marker_mode_active and
                       self.marker_selected_student and student and
                       student.id == self.marker_selected_student.id)

        if is_drop_target:
            painter.setBrush(QBrush(QColor(theme.DROP_TARGET_BG)))
            painter.setPen(QPen(QColor(theme.DROP_TARGET_BORDER), 2))
            painter.drawRect(frect)

        if is_dragging_from:
            return

        if not student:
            if not neighbor_mode:
                return
            if is_source:
                bg, bc, bw = theme.NEIGHBOR_SOURCE_BG, theme.NEIGHBOR_SOURCE_BORDER, 2
            elif is_nbr:
                bg, bc, bw = theme.NEIGHBOR_TARGET_BG, theme.NEIGHBOR_TARGET_BORDER, 2
            else:
                bg, bc, bw = theme.NEIGHBOR_NONE_BG, theme.NEIGHBOR_NONE_BORDER, 1
            trect = QRect(frect.x() + 4, frect.y() + 4,
                          frect.width() - 8, frect.height() - 8)
            painter.setBrush(QBrush(QColor(bg)))
            painter.setPen(QPen(QColor(bc), bw))
            painter.drawRect(trect)
            return

        # Occupied desk — determine appearance
        if is_fixture:
            bg, bc, bw = theme.DESK_FIXTURE_BG, theme.DESK_FIXTURE_BORDER, 1
        elif is_selected:
            bg, bc, bw = theme.DESK_SELECTED_BG, theme.DESK_SELECTED_BORDER, 2
        elif neighbor_mode:
            if is_source:
                bg, bc, bw = theme.NEIGHBOR_SOURCE_BG, theme.NEIGHBOR_SOURCE_BORDER, 3
            elif is_nbr:
                bg, bc, bw = theme.NEIGHBOR_TARGET_BG, theme.NEIGHBOR_TARGET_BORDER, 2
            else:
                bg, bc, bw = theme.NEIGHBOR_NONE_BG, theme.NEIGHBOR_NONE_BORDER, 1
        elif self.violation_mode:
            has_viol = self._has_violation(student, fid, violation_id_map)
            if has_viol:
                bg = theme.VIOLATION_BAD_BG
                bc = theme.DESK_LOCKED_BORDER if is_locked else theme.VIOLATION_BAD_BORDER
            else:
                bg = theme.VIOLATION_OK_BG
                bc = theme.DESK_LOCKED_BORDER if is_locked else theme.VIOLATION_OK_BORDER
            bw = 2
        elif is_locked:
            bg, bc, bw = theme.DESK_LOCKED_BG, theme.DESK_LOCKED_BORDER, 2
        else:
            bg, bc, bw = theme.DESK_OCCUPIED_BG, theme.DESK_OCCUPIED_BORDER, 1

        trect = QRect(frect.x() + 4, frect.y() + 4,
                      frect.width() - 8, frect.height() - 8)
        painter.setBrush(QBrush(QColor(bg)))
        painter.setPen(QPen(QColor(bc), bw))
        painter.drawRect(trect)

        painter.setPen(QPen(QColor(
            theme.DESK_FIXTURE_TEXT if is_fixture else theme.DESK_TEXT
        )))
        font = painter.font()
        font.setPointSize(8)
        font.setBold(not is_fixture)
        painter.setFont(font)
        painter.drawText(trect,
                         Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap,
                         student.name)

        if is_locked and not is_fixture:
            sz  = 6
            lrect = QRect(trect.right() - sz - 1, trect.top() + 1, sz, sz)
            painter.fillRect(lrect, QColor(theme.DESK_LOCKED_BORDER))
