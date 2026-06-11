from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
                              QScrollArea, QPushButton, QSplitter, QListWidget,
                              QListWidgetItem, QFileDialog, QMessageBox, QInputDialog,
                              QDoubleSpinBox, QDialog, QMenu)
from PyQt6.QtCore import Qt, QRect, QPoint, pyqtSignal
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QPixmap, QCursor, QFont
from typing import List, Optional, Dict, Set
from pathlib import Path

from src.models.student import Student
from src.models.classroom import Classroom
from src.models.furniture import Furniture
from src.models.preference import Preference, PreferenceTargetType
from src.io.csv_handler import StudentImporter
from src.ui.dialogs import StudentOptionsDialog, AlgorithmSelectionDialog, StudentInfoDialog
from src.algorithm.seat_graph import SeatGraph, PROXIMITY_THRESHOLD
from src.io.csv_handler import StudentExporter
from src.io.arrangement_io import ArrangementIO
from src.ui import theme


def _toolbar_stylesheet() -> str:
    return f"""
        QWidget#toolbar {{
            background-color: {theme.TOOLBAR_BG};
        }}
        QPushButton {{
            background-color: {theme.TOOLBAR_BTN_BG};
            color: {theme.TOOLBAR_TEXT};
            border: 1px solid {theme.TOOLBAR_BTN_BORDER};
            border-radius: 4px;
            padding: 4px 10px;
        }}
        QPushButton:hover {{
            background-color: {theme.TOOLBAR_BTN_HOVER};
        }}
        QPushButton:pressed {{
            background-color: {theme.TOOLBAR_BTN_PRESSED};
        }}
        QLabel {{
            color: {theme.TOOLBAR_LABEL_COLOR};
        }}
        QDoubleSpinBox {{
            background-color: {theme.TOOLBAR_BTN_BG};
            color: {theme.TOOLBAR_TEXT};
            border: 1px solid {theme.TOOLBAR_BTN_BORDER};
            border-radius: 4px;
            padding: 2px 4px;
        }}
        QDoubleSpinBox::up-button, QDoubleSpinBox::down-button {{
            width: 14px;
        }}
    """


class StudentListWidget(QWidget):
    """Scrollable list of students with import button"""

    def __init__(self):
        super().__init__()
        self.students: List[Student] = []
        self.importer = StudentImporter()
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.setStyleSheet(f"background-color: {theme.PANEL_BG};")

        title = QLabel("Students")
        title.setStyleSheet(
            f"font-weight: bold; font-size: 14px; padding: 10px;"
            f"color: {theme.PANEL_HEADER_COLOR};"
        )
        layout.addWidget(title)

        self.count_label = QLabel("No students loaded")
        self.count_label.setStyleSheet(f"padding: 5px 10px; color: {theme.PANEL_HEADER_COLOR};")
        layout.addWidget(self.count_label)

        self.student_list = QListWidget()
        self.student_list.setStyleSheet(f"""
            QListWidget {{
                border: 1px solid {theme.PANEL_ITEM_BORDER};
                background: {theme.PANEL_ITEM_BG};
            }}
            QListWidget::item {{
                padding: 8px;
                border-bottom: 1px solid {theme.PANEL_ITEM_BORDER};
            }}
            QListWidget::item:selected {{
                background: {theme.PANEL_ITEM_SELECTED};
                color: black;
            }}
        """)
        self.student_list.itemDoubleClicked.connect(self.on_student_double_clicked)
        layout.addWidget(self.student_list)

        import_btn = QPushButton("Import Student List (CSV)")
        import_btn.clicked.connect(self.import_students)
        layout.addWidget(import_btn)

    def on_student_double_clicked(self, item: QListWidgetItem):
        """Handle double-click on student - show options dialog"""
        student = item.data(Qt.ItemDataRole.UserRole)

        dialog = StudentOptionsDialog(student, self.students, self)
        result = dialog.exec()

        if result == QDialog.DialogCode.Accepted:
            new_name = dialog.get_updated_name()
            if new_name != student.name:
                student.name = new_name
                self.update_list()

        elif result == 2:  # Delete code
            self.students.remove(student)
            self.update_list()
            QMessageBox.information(self, "Deleted", f"Deleted {student.name}")

    def import_students(self):
        """Import students from CSV"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select Student List CSV",
            "data/students",
            "CSV Files (*.csv);;All Files (*)"
        )

        if file_path:
            try:
                self.students = self.importer.import_from_csv(file_path)
                self.update_list()

                msg = f"Imported {len(self.students)} student(s)."
                if self.importer.warnings:
                    msg += "\n\nWarnings:\n" + "\n".join(f"• {w}" for w in self.importer.warnings)
                    QMessageBox.warning(self, "Import Complete with Warnings", msg)
                else:
                    QMessageBox.information(self, "Import Successful", msg)

            except UnicodeDecodeError:
                QMessageBox.critical(
                    self, "Encoding Error",
                    "Could not read the file — it may not be UTF-8 encoded.\n"
                    "Try re-saving the CSV with UTF-8 encoding."
                )
            except Exception as e:
                QMessageBox.critical(
                    self, "Import Failed",
                    f"Failed to import students:\n{str(e)}"
                )

    def update_list(self):
        """Update the displayed list of students"""
        self.student_list.clear()
        self.count_label.setText(f"{len(self.students)} students")

        for student in self.students:
            pref_text = f" ({len(student.preferences)} prefs)" if student.preferences else ""
            item = QListWidgetItem(f"{student.name}{pref_text}")
            item.setData(Qt.ItemDataRole.UserRole, student)
            self.student_list.addItem(item)

    def get_students(self) -> List[Student]:
        return self.students

    def set_students(self, students: List[Student]):
        self.students = students
        self.update_list()


class SeatingGrid(QWidget):
    """Grid showing classroom with student assignments"""

    marker_mode_exited = pyqtSignal()
    student_info_requested = pyqtSignal(object)  # emits Student

    def __init__(self, grid_width: int = 20, grid_height: int = 15, cell_size: int = 40):
        super().__init__()
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.cell_size = cell_size
        self.furniture_list: List[Furniture] = []
        self.assignments: Dict[str, Student] = {}

        self.marker_mode_active = False
        self.marker_mode_weight = -1.0
        self.marker_selected_student: Optional[Student] = None

        self.locked_seats: Set[str] = set()
        self.fixture_seats: Set[str] = set()

        self.dragging_from: Optional[str] = None
        self.drag_student: Optional[Student] = None
        self.drag_cursor_pos: Optional[QPoint] = None
        self.drag_hover_fid: Optional[str] = None

        self.violation_mode: bool = False
        self.current_seat_graph: Optional[SeatGraph] = None

        self.neighbor_preview_fid: Optional[str] = None  # desk whose neighbors are highlighted

        self.update_size()

    def set_marker_mode(self, active: bool, weight: float = -1.0):
        """Enable or disable marker mode"""
        self.marker_mode_active = active
        self.marker_mode_weight = weight
        self.marker_selected_student = None

        if active:
            self.setCursor(QCursor(Qt.CursorShape.CrossCursor))
        else:
            self.setCursor(QCursor(Qt.CursorShape.ArrowCursor))

        self.update()

    def set_violation_mode(self, active: bool):
        self.violation_mode = active
        self.update()

    def set_seat_graph(self, seat_graph: SeatGraph):
        self.current_seat_graph = seat_graph
        self.update()

    def _build_id_map(self) -> Dict[str, str]:
        """Build student_id → furniture_id map from current assignments (non-fixtures only)."""
        return {
            s.id: f for f, s in self.assignments.items()
            if f not in self.fixture_seats
        }

    def _has_violation(self, student: Student, fid: str, id_map: Dict[str, str]) -> bool:
        """Return True if any avoid-preference for this student is currently violated.
        id_map must be pre-computed via _build_id_map() for this paint frame."""
        if not self.current_seat_graph:
            return False

        for pref in student.preferences:
            if pref.weight >= 0:
                continue
            if pref.target_type == PreferenceTargetType.STUDENT:
                target_fid = id_map.get(pref.target_id)
                if target_fid and target_fid != fid and self.current_seat_graph.are_neighbors(fid, target_fid):
                    return True
            elif pref.target_type == PreferenceTargetType.FURNITURE:
                fixture_fid = self.current_seat_graph.fixture_id_to_fid.get(pref.target_id)
                if fixture_fid and self.current_seat_graph.are_neighbors(fid, fixture_fid):
                    return True

        # Bidirectional: check if any placed student avoids this student
        for placed_fid, placed_student in self.assignments.items():
            if placed_fid == fid or placed_fid in self.fixture_seats:
                continue
            for pref in placed_student.preferences:
                if (pref.weight < 0 and
                        pref.target_type == PreferenceTargetType.STUDENT and
                        pref.target_id == student.id and
                        self.current_seat_graph.are_neighbors(fid, placed_fid)):
                    return True

        return False

    def keyPressEvent(self, event):
        """Handle keyboard events - ESC exits marker mode"""
        if event.key() == Qt.Key.Key_Escape and self.marker_mode_active:
            self.set_marker_mode(False)
            self.marker_mode_exited.emit()
            print("Exited marker mode")

    def mousePressEvent(self, event):
        if self.marker_mode_active:
            self._handle_marker_click(event)
        elif event.button() == Qt.MouseButton.LeftButton:
            self._start_drag(event)

    def _handle_marker_click(self, event):
        grid_x = event.position().toPoint().x() // self.cell_size
        grid_y = event.position().toPoint().y() // self.cell_size

        clicked_furniture = None
        for furniture in self.furniture_list:
            if (grid_x, grid_y) in furniture.get_occupied_cells():
                clicked_furniture = furniture
                break

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
                QMessageBox.information(self, "Same Student", "Cannot create preference with self!")
                return

            pref = Preference(
                target_type=PreferenceTargetType.STUDENT,
                target_id=clicked_student.id,
                weight=self.marker_mode_weight
            )
            self.marker_selected_student.add_preference(pref)
            self.marker_selected_student = None
            self.update()

    def _start_drag(self, event):
        grid_x = event.position().toPoint().x() // self.cell_size
        grid_y = event.position().toPoint().y() // self.cell_size

        for furniture in self.furniture_list:
            if (grid_x, grid_y) in furniture.get_occupied_cells():
                fid = furniture.furniture_id
                student = self.assignments.get(fid)
                if student and fid not in self.fixture_seats:
                    self.dragging_from = fid
                    self.drag_student = student
                    self.drag_cursor_pos = event.position().toPoint()
                    self.drag_hover_fid = fid
                    self.update()
                break

    def mouseMoveEvent(self, event):
        if not self.dragging_from:
            return

        self.drag_cursor_pos = event.position().toPoint()

        grid_x = self.drag_cursor_pos.x() // self.cell_size
        grid_y = self.drag_cursor_pos.y() // self.cell_size

        hover_fid = None
        for furniture in self.furniture_list:
            if (grid_x, grid_y) in furniture.get_occupied_cells():
                if furniture.furniture_id not in self.fixture_seats:
                    hover_fid = furniture.furniture_id
                break

        self.drag_hover_fid = hover_fid
        self.update()

    def mouseReleaseEvent(self, event):
        if event.button() != Qt.MouseButton.LeftButton or not self.dragging_from:
            return

        release_pos = event.position().toPoint()
        grid_x = release_pos.x() // self.cell_size
        grid_y = release_pos.y() // self.cell_size

        target_fid = None
        for furniture in self.furniture_list:
            if (grid_x, grid_y) in furniture.get_occupied_cells():
                if furniture.furniture_id not in self.fixture_seats:
                    target_fid = furniture.furniture_id
                break

        if target_fid and target_fid != self.dragging_from:
            source_student = self.drag_student
            target_student = self.assignments.get(target_fid)

            self.assignments[target_fid] = source_student

            if target_student:
                self.assignments[self.dragging_from] = target_student
            else:
                self.assignments.pop(self.dragging_from, None)

            # Manual drag clears locks on both desks
            self.locked_seats.discard(self.dragging_from)
            self.locked_seats.discard(target_fid)

        self.dragging_from = None
        self.drag_student = None
        self.drag_cursor_pos = None
        self.drag_hover_fid = None
        self.update()

    def update_size(self):
        self.setMinimumSize(
            self.grid_width * self.cell_size,
            self.grid_height * self.cell_size
        )
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    def set_classroom(self, classroom: Classroom):
        self.furniture_list = classroom.furniture
        self.grid_width = classroom.grid_width
        self.grid_height = classroom.grid_height
        self.assignments.clear()
        self.locked_seats.clear()
        self.fixture_seats.clear()
        self.current_seat_graph = None
        self.neighbor_preview_fid = None
        self.update_size()
        self.update()

    def apply_fixtures(self, fixtures: Dict[str, Student]):
        """Set fixture (non-seat) furniture labels. Called on classroom load."""
        for fid in self.fixture_seats:
            self.assignments.pop(fid, None)
        self.fixture_seats = set(fixtures.keys())
        self.assignments.update(fixtures)
        self.update()

    def load_furniture_image(self, image_path: str) -> Optional[QPixmap]:
        if image_path:
            pixmap = QPixmap(str(image_path))
            if not pixmap.isNull():
                return pixmap
        return None

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        painter.fillRect(self.rect(), QColor(theme.GRID_BG))

        painter.setPen(QPen(QColor(theme.GRID_LINE), 1))

        for x in range(self.grid_width + 1):
            x_pos = x * self.cell_size
            painter.drawLine(x_pos, 0, x_pos, self.grid_height * self.cell_size)

        for y in range(self.grid_height + 1):
            y_pos = y * self.cell_size
            painter.drawLine(0, y_pos, self.grid_width * self.cell_size, y_pos)

        violation_id_map = self._build_id_map() if self.violation_mode else {}

        neighbor_set: Set[str] = set()
        if self.neighbor_preview_fid and self.current_seat_graph:
            neighbor_set = set(self.current_seat_graph.neighbors(self.neighbor_preview_fid))

        for furniture in self.furniture_list:
            self.draw_furniture_with_student(painter, furniture, violation_id_map, neighbor_set)

        if self.drag_student and self.drag_cursor_pos:
            self._draw_drag_preview(painter)

    def _draw_drag_preview(self, painter: QPainter):
        label = self.drag_student.name
        w, h = 80, 28
        rect = QRect(
            self.drag_cursor_pos.x() - w // 2,
            self.drag_cursor_pos.y() - h // 2,
            w, h
        )
        painter.setBrush(QBrush(QColor(theme.DRAG_PREVIEW_BG)))
        painter.setPen(QPen(QColor(theme.DRAG_PREVIEW_BORDER), 2))
        painter.drawRoundedRect(rect, 4, 4)
        painter.setPen(QPen(QColor(theme.DRAG_PREVIEW_TEXT)))
        font = painter.font()
        font.setPointSize(8)
        font.setBold(True)
        painter.setFont(font)
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, label)

    def draw_furniture_with_student(self, painter: QPainter, furniture: Furniture, violation_id_map: Dict[str, str] = {}, neighbor_set: Set[str] = set()):
        x, y = furniture.position

        furniture_rect = QRect(
            x * self.cell_size + 2,
            y * self.cell_size + 2,
            furniture.width * self.cell_size - 4,
            furniture.height * self.cell_size - 4
        )

        if furniture.image_path:
            furniture_image = self.load_furniture_image(furniture.image_path)
            if furniture_image:
                scaled_image = furniture_image.scaled(
                    furniture_rect.size(),
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation
                )

                x_offset = furniture_rect.x() + (furniture_rect.width() - scaled_image.width()) // 2
                y_offset = furniture_rect.y() + (furniture_rect.height() - scaled_image.height()) // 2

                painter.drawPixmap(x_offset, y_offset, scaled_image)

        fid = furniture.furniture_id
        student = self.assignments.get(fid)
        is_fixture = fid in self.fixture_seats
        is_locked = fid in self.locked_seats
        is_drag_source = fid == self.dragging_from
        is_drop_target = (self.dragging_from is not None and
                          fid == self.drag_hover_fid and
                          fid != self.dragging_from)

        if is_drop_target:
            painter.setBrush(QBrush(QColor(theme.DROP_TARGET_BG)))
            painter.setPen(QPen(QColor(theme.DROP_TARGET_BORDER), 2))
            painter.drawRect(furniture_rect)

        is_selected = (not is_fixture and
                       self.marker_mode_active and
                       self.marker_selected_student and
                       student and
                       student.id == self.marker_selected_student.id)

        if is_drag_source:
            return

        neighbor_mode_active = bool(self.neighbor_preview_fid)
        is_source = fid == self.neighbor_preview_fid
        is_nbr = fid in neighbor_set

        # Empty desk: only draw something when neighbor mode is showing context
        if not student:
            if not neighbor_mode_active:
                return
            if is_source:
                bg_color = QColor(theme.NEIGHBOR_SOURCE_BG)
                border_color = QColor(theme.NEIGHBOR_SOURCE_BORDER)
                border_width = 2
            elif is_nbr:
                bg_color = QColor(theme.NEIGHBOR_TARGET_BG)
                border_color = QColor(theme.NEIGHBOR_TARGET_BORDER)
                border_width = 2
            else:
                bg_color = QColor(theme.NEIGHBOR_NONE_BG)
                border_color = QColor(theme.NEIGHBOR_NONE_BORDER)
                border_width = 1
            painter.setBrush(QBrush(bg_color))
            painter.setPen(QPen(border_color, border_width))
            text_rect = QRect(
                furniture_rect.x() + 4,
                furniture_rect.y() + 4,
                furniture_rect.width() - 8,
                furniture_rect.height() - 8,
            )
            painter.drawRect(text_rect)
            return

        # Occupied desk — pick colors in priority order
        if is_fixture:
            bg_color = QColor(theme.DESK_FIXTURE_BG)
            border_color = QColor(theme.DESK_FIXTURE_BORDER)
            border_width = 1
        elif is_selected:
            bg_color = QColor(theme.DESK_SELECTED_BG)
            border_color = QColor(theme.DESK_SELECTED_BORDER)
            border_width = 2
        elif neighbor_mode_active:
            if is_source:
                bg_color = QColor(theme.NEIGHBOR_SOURCE_BG)
                border_color = QColor(theme.NEIGHBOR_SOURCE_BORDER)
                border_width = 3
            elif is_nbr:
                bg_color = QColor(theme.NEIGHBOR_TARGET_BG)
                border_color = QColor(theme.NEIGHBOR_TARGET_BORDER)
                border_width = 2
            else:
                bg_color = QColor(theme.NEIGHBOR_NONE_BG)
                border_color = QColor(theme.NEIGHBOR_NONE_BORDER)
                border_width = 1
        elif self.violation_mode:
            has_viol = self._has_violation(student, fid, violation_id_map)
            if has_viol:
                bg_color = QColor(theme.VIOLATION_BAD_BG)
                border_color = QColor(
                    theme.DESK_LOCKED_BORDER if is_locked else theme.VIOLATION_BAD_BORDER
                )
            else:
                bg_color = QColor(theme.VIOLATION_OK_BG)
                border_color = QColor(
                    theme.DESK_LOCKED_BORDER if is_locked else theme.VIOLATION_OK_BORDER
                )
            border_width = 2
        elif is_locked:
            bg_color = QColor(theme.DESK_LOCKED_BG)
            border_color = QColor(theme.DESK_LOCKED_BORDER)
            border_width = 2
        else:
            bg_color = QColor(theme.DESK_OCCUPIED_BG)
            border_color = QColor(theme.DESK_OCCUPIED_BORDER)
            border_width = 1

        painter.setBrush(QBrush(bg_color))
        painter.setPen(QPen(border_color, border_width))

        text_rect = QRect(
            furniture_rect.x() + 4,
            furniture_rect.y() + 4,
            furniture_rect.width() - 8,
            furniture_rect.height() - 8
        )
        painter.drawRect(text_rect)

        painter.setPen(QPen(QColor(
            theme.DESK_FIXTURE_TEXT if is_fixture else theme.DESK_TEXT
        )))
        font = painter.font()
        font.setPointSize(8)
        font.setBold(not is_fixture)
        painter.setFont(font)
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignCenter | Qt.TextFlag.TextWordWrap,
                         student.name)

        if is_locked and not is_fixture:
            lock_size = 6
            lock_rect = QRect(
                text_rect.right() - lock_size - 1,
                text_rect.top() + 1,
                lock_size,
                lock_size
            )
            painter.fillRect(lock_rect, QColor(theme.DESK_LOCKED_BORDER))

    def apply_assignments(self, assignments: Dict[str, Student]):
        """Apply student assignments from an allocator. Fixture assignments are preserved."""
        preserved = {fid: s for fid, s in self.assignments.items() if fid in self.fixture_seats}
        self.assignments = dict(assignments)
        self.assignments.update(preserved)
        self.update()

    def clear_assignments(self):
        self.assignments = {fid: s for fid, s in self.assignments.items() if fid in self.fixture_seats}
        self.locked_seats.clear()
        self.update()

    def get_assignments(self) -> Dict[str, Student]:
        return self.assignments

    def contextMenuEvent(self, event):
        grid_x = event.pos().x() // self.cell_size
        grid_y = event.pos().y() // self.cell_size

        clicked_furniture = None
        for furniture in self.furniture_list:
            if (grid_x, grid_y) in furniture.get_occupied_cells():
                clicked_furniture = furniture
                break

        if not clicked_furniture:
            # Right-click on empty grid — clear neighbor preview
            if self.neighbor_preview_fid is not None:
                self.neighbor_preview_fid = None
                self.update()
            return

        fid = clicked_furniture.furniture_id

        # Toggle neighbor highlight on every right-click (with or without a student)
        if self.current_seat_graph:
            self.neighbor_preview_fid = None if fid == self.neighbor_preview_fid else fid
            self.update()

        student = self.assignments.get(fid)
        if not student:
            return

        menu = QMenu(self)

        # Bold name header — non-interactive
        header = menu.addAction(student.name)
        header.setEnabled(False)
        bold = QFont()
        bold.setBold(True)
        header.setFont(bold)

        menu.addSeparator()

        if fid in self.fixture_seats:
            fixture_label = menu.addAction("Fixture — not a student seat")
            fixture_label.setEnabled(False)
        else:
            # Neighbor count line
            if self.current_seat_graph:
                neighbor_fids = self.current_seat_graph.neighbors(fid)
                neighbor_count = len(neighbor_fids)
                nbr_label = menu.addAction(
                    f"{neighbor_count} neighboring desk{'s' if neighbor_count != 1 else ''}"
                )
                nbr_label.setEnabled(False)
                menu.addSeparator()

            pref_count = len(student.preferences)
            pref_text = (
                f"Show Preferences ({pref_count})" if pref_count else "No Preferences"
            )
            prefs_action = menu.addAction(pref_text)
            prefs_action.triggered.connect(
                lambda checked=False, s=student: self.student_info_requested.emit(s)
            )

            menu.addSeparator()

            if fid in self.locked_seats:
                unlock = menu.addAction("Unlock from desk")
                unlock.triggered.connect(lambda: self._unlock_seat(fid))
            else:
                lock = menu.addAction("Lock to this desk")
                lock.triggered.connect(lambda: self._lock_seat(fid))

        menu.exec(event.globalPos())

    def clear_neighbor_preview(self):
        self.neighbor_preview_fid = None
        self.update()

    def _lock_seat(self, furniture_id: str):
        self.locked_seats.add(furniture_id)
        self.update()

    def _unlock_seat(self, furniture_id: str):
        self.locked_seats.discard(furniture_id)
        self.update()


class StudentPlacerWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.students: List[Student] = []
        self.current_classroom: Optional[Classroom] = None
        self.proximity_threshold: float = PROXIMITY_THRESHOLD
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        toolbar_widget = QWidget()
        toolbar_widget.setObjectName("toolbar")
        toolbar_widget.setStyleSheet(_toolbar_stylesheet() + f"""
            QPushButton#markerBtn:checked {{
                background-color: #E53935;
                color: {theme.TOOLBAR_TEXT};
            }}
            QPushButton#violationsBtn:checked {{
                background-color: {theme.TOOLBAR_BTN_CHECKED};
                color: {theme.TOOLBAR_TEXT};
            }}
        """)
        toolbar_layout = QHBoxLayout(toolbar_widget)
        toolbar_layout.setContentsMargins(6, 4, 6, 4)
        toolbar_layout.setSpacing(6)

        load_classroom_btn = QPushButton("Load Classroom")
        load_classroom_btn.clicked.connect(self.load_classroom)
        toolbar_layout.addWidget(load_classroom_btn)

        allocate_btn = QPushButton("Allocate Students to Desks")
        allocate_btn.clicked.connect(self.allocate_students)
        toolbar_layout.addWidget(allocate_btn)

        clear_btn = QPushButton("Clear Assignments")
        clear_btn.clicked.connect(self.clear_assignments)
        toolbar_layout.addWidget(clear_btn)

        export_btn = QPushButton("Export Students (CSV)")
        export_btn.clicked.connect(self.export_students)
        toolbar_layout.addWidget(export_btn)

        save_arr_btn = QPushButton("Save Arrangement")
        save_arr_btn.clicked.connect(self.save_arrangement)
        toolbar_layout.addWidget(save_arr_btn)

        load_arr_btn = QPushButton("Load Arrangement")
        load_arr_btn.clicked.connect(self.load_arrangement)
        toolbar_layout.addWidget(load_arr_btn)

        self.violations_btn = QPushButton("Show Violations")
        self.violations_btn.setObjectName("violationsBtn")
        self.violations_btn.setCheckable(True)
        self.violations_btn.toggled.connect(self.seating_grid_set_violation_mode)
        toolbar_layout.addWidget(self.violations_btn)

        nearness_label = QLabel("Nearness:")
        toolbar_layout.addWidget(nearness_label)

        self.nearness_spin = QDoubleSpinBox()
        self.nearness_spin.setRange(0.5, 10.0)
        self.nearness_spin.setSingleStep(0.5)
        self.nearness_spin.setValue(PROXIMITY_THRESHOLD)
        self.nearness_spin.setDecimals(1)
        self.nearness_spin.setFixedWidth(70)
        self.nearness_spin.setToolTip(
            "Distance (grid units) within which two desks are considered neighbors.\n"
            "1.5 = direct + diagonal. Increase to widen the neighborhood."
        )
        self.nearness_spin.valueChanged.connect(self.on_nearness_changed)
        toolbar_layout.addWidget(self.nearness_spin)

        toolbar_layout.addStretch()

        marker_label = QLabel("Weight:")
        toolbar_layout.addWidget(marker_label)

        self.weight_field = QDoubleSpinBox()
        self.weight_field.setRange(-1000, 1000)
        self.weight_field.setValue(-1.0)
        self.weight_field.setDecimals(1)
        self.weight_field.setFixedWidth(80)
        toolbar_layout.addWidget(self.weight_field)

        self.marker_btn = QPushButton("Red Marker Mode")
        self.marker_btn.setObjectName("markerBtn")
        self.marker_btn.setCheckable(True)
        self.marker_btn.toggled.connect(self.toggle_marker_mode)
        toolbar_layout.addWidget(self.marker_btn)

        self.hint_label = QLabel("")
        toolbar_layout.addWidget(self.hint_label)

        toolbar_layout.addStretch()

        self.classroom_label = QLabel("No classroom loaded")
        self.classroom_label.setStyleSheet(f"font-weight: bold; color: {theme.TOOLBAR_TEXT};")
        toolbar_layout.addWidget(self.classroom_label)

        layout.addWidget(toolbar_widget)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        self.student_list_widget = StudentListWidget()
        splitter.addWidget(self.student_list_widget)

        self.seating_grid = SeatingGrid(grid_width=20, grid_height=15, cell_size=40)
        self.seating_grid.marker_mode_exited.connect(self.on_marker_mode_exited)
        self.seating_grid.student_info_requested.connect(self.show_student_info)
        splitter.addWidget(self.seating_grid)

        splitter.setSizes([200, 800])
        layout.addWidget(splitter)

    def show_student_info(self, student):
        all_students = self.student_list_widget.get_students()
        dialog = StudentInfoDialog(student, all_students, self)
        dialog.exec()

    def on_nearness_changed(self, value: float):
        self.proximity_threshold = value
        if self.current_classroom:
            seat_graph = SeatGraph(self.current_classroom, proximity_threshold=value)
            self.seating_grid.set_seat_graph(seat_graph)
            # If a neighbor preview is active, the set_seat_graph triggers a repaint
            # which will recompute neighbors with the new threshold automatically.

    def seating_grid_set_violation_mode(self, checked: bool):
        if checked:
            if not self.current_classroom:
                self.violations_btn.setChecked(False)
                QMessageBox.information(
                    self, "No Classroom",
                    "Load a classroom before using violation highlighting."
                )
                return
            # Rebuild seat graph fresh so edge data matches the current layout
            self.seating_grid.set_seat_graph(SeatGraph(self.current_classroom, proximity_threshold=self.proximity_threshold))
        self.seating_grid.set_violation_mode(checked)

    def on_marker_mode_exited(self):
        self.marker_btn.setChecked(False)
        self.hint_label.setText("")
        self.weight_field.setEnabled(True)

    def toggle_marker_mode(self, checked: bool):
        weight = self.weight_field.value()
        self.seating_grid.set_marker_mode(checked, weight)

        if checked:
            self.hint_label.setText("Click a student, then click another to create preference. ESC to exit.")
            self.weight_field.setEnabled(False)
        else:
            self.hint_label.setText("")
            self.weight_field.setEnabled(True)

    def load_classroom(self):
        saved_classrooms = Classroom.list_saved_classrooms()

        if not saved_classrooms:
            QMessageBox.information(
                self,
                "No Classrooms",
                "No saved classrooms found. Please create one in the Classroom Builder."
            )
            return

        name, ok = QInputDialog.getItem(
            self,
            "Load Classroom",
            "Select classroom:",
            saved_classrooms,
            0,
            False
        )

        if not ok or not name:
            return

        try:
            filepath = Path("data/classrooms") / f"{name}.json"
            classroom = Classroom.load_from_file(filepath)

            seats = sum(len(f.get_seats()) for f in classroom.furniture)

            self.current_classroom = classroom
            self.seating_grid.set_classroom(classroom)

            seat_graph = SeatGraph(classroom, proximity_threshold=self.proximity_threshold)
            self.seating_grid.apply_fixtures(seat_graph.fixtures)
            self.seating_grid.set_seat_graph(seat_graph)

            self.classroom_label.setText(f"Classroom: {name}\nSeats: {seats}")

            QMessageBox.information(
                self,
                "Success",
                f"Loaded classroom: {name}\n{seats} seats available"
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Error",
                f"Failed to load classroom:\n{str(e)}"
            )

    def allocate_students(self):
        if not self.current_classroom:
            QMessageBox.warning(self, "No Classroom", "Please load a classroom first.")
            return

        all_students = self.student_list_widget.get_students()
        students = [s for s in all_students if not s.metadata.get('is_fixture')]

        if not students:
            QMessageBox.warning(self, "No Students", "Please import students first.")
            return

        dialog = AlgorithmSelectionDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        seat_graph = SeatGraph(self.current_classroom, proximity_threshold=self.proximity_threshold)

        if not seat_graph.assignable:
            QMessageBox.warning(
                self, "No Seats",
                "This classroom has no assignable seats.\n"
                "Add student desks in the Classroom Builder first."
            )
            return

        # Pre-populate locked seats so the allocator leaves them in place
        for furniture_id, student in self.seating_grid.assignments.items():
            if furniture_id in self.seating_grid.locked_seats:
                seat_graph.assign(furniture_id, student)
                seat_graph.lock(furniture_id)

        allocator = dialog.get_allocator()
        assignments = allocator.allocate(students, self.current_classroom, seat_graph)
        self.seating_grid.apply_assignments(assignments)
        self.seating_grid.set_seat_graph(seat_graph)

        placed = len([
            fid for fid in assignments
            if fid not in self.seating_grid.fixture_seats
        ])
        seats_available = len(seat_graph.assignable)
        if placed < len(students):
            unplaced = len(students) - placed
            QMessageBox.warning(
                self, "Not All Placed",
                f"{placed} of {len(students)} students assigned.\n"
                f"{unplaced} student(s) couldn't be placed — "
                f"only {seats_available} seat(s) available."
            )
        else:
            QMessageBox.information(
                self, "Done",
                f"All {placed} students assigned to seats."
            )

    def clear_assignments(self):
        self.seating_grid.clear_assignments()

    def export_students(self):
        """Export current student list (+ fixture info) to full-format CSV."""
        students = self.student_list_widget.get_students()
        if not students:
            QMessageBox.warning(self, "No Students", "No students to export.")
            return

        filepath, _ = QFileDialog.getSaveFileName(
            self, "Export Students", "data/students/students.csv",
            "CSV Files (*.csv)"
        )
        if not filepath:
            return

        id_to_name = {s.id: s.name for s in students}
        fixture_students = []
        for fid in self.seating_grid.fixture_seats:
            fx = self.seating_grid.assignments.get(fid)
            if fx:
                id_to_name[fx.id] = fx.name
                if not any(s.id == fx.id for s in students):
                    from src.models.student import Student as _S
                    fixture_students.append(_S(
                        id=fx.id, name=fx.name,
                        metadata={'is_fixture': True}
                    ))

        try:
            StudentExporter().export_to_csv(students + fixture_students, filepath, id_to_name)
            QMessageBox.information(self, "Exported", f"Students exported to {filepath}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to export:\n{e}")

    def save_arrangement(self):
        """Save current seating arrangement to JSON."""
        if not self.current_classroom:
            QMessageBox.warning(self, "No Classroom", "Please load a classroom first.")
            return

        assignments = self.seating_grid.get_assignments()
        if not any(fid not in self.seating_grid.fixture_seats for fid in assignments):
            QMessageBox.warning(self, "No Assignments", "No students have been assigned yet.")
            return

        try:
            filepath = ArrangementIO.save(
                self.current_classroom.name,
                assignments,
                self.seating_grid.fixture_seats,
            )
            QMessageBox.information(self, "Saved", f"Arrangement saved to {filepath}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save arrangement:\n{e}")

    def load_arrangement(self):
        """Load a saved seating arrangement and apply it to the current grid."""
        students = [s for s in self.student_list_widget.get_students()
                    if not s.metadata.get('is_fixture')]
        if not students:
            QMessageBox.warning(self, "No Students", "Please import students first.")
            return

        saved = ArrangementIO.list_saved()
        if not saved:
            QMessageBox.information(self, "No Arrangements", "No saved arrangements found.")
            return

        name, ok = QInputDialog.getItem(
            self, "Load Arrangement", "Select arrangement:", saved, 0, False
        )
        if not ok or not name:
            return

        try:
            filepath = Path("data/arrangements") / f"{name}.json"
            assignments, _ = ArrangementIO.load(filepath, students)
            self.seating_grid.apply_assignments(assignments)

            if self.current_classroom:
                seat_graph = SeatGraph(self.current_classroom, proximity_threshold=self.proximity_threshold)
                self.seating_grid.set_seat_graph(seat_graph)

            matched = len(assignments)
            skipped = len(students) - matched
            msg = f"Loaded arrangement: {name}\n{matched} of {len(students)} students matched."
            if skipped > 0:
                msg += f"\n{skipped} student(s) not found in the saved arrangement."
            QMessageBox.information(self, "Loaded", msg)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to load arrangement:\n{e}")

    def set_students(self, students: List[Student]):
        self.students = students
        self.student_list_widget.set_students(students)
