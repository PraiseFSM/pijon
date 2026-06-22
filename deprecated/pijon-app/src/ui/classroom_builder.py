from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
                              QScrollArea, QPushButton, QSplitter, QInputDialog,
                              QMessageBox, QSpinBox)
from PyQt6.QtCore import Qt, QMimeData, QPoint, QRect
from PyQt6.QtGui import QPainter, QColor, QDrag, QPen, QBrush, QPixmap
from typing import List, Optional, Tuple
from pathlib import Path

from src.models.classroom import Classroom
from src.models.furniture import Furniture, FurnitureType
from src.ui import theme

DEFAULT_IMAGE_PATH = "data/furniture_images/default_desk.png"

BASE_CELL_SIZE = 40
CELL_SIZE_MAX  = 80
CELL_SIZE_MIN  = 10


def _load_image(image_path: Optional[str]) -> Optional[QPixmap]:
    """Load a QPixmap from *image_path*; return None if missing or invalid."""
    if image_path:
        px = QPixmap(str(image_path))
        if not px.isNull():
            return px
    return None


class FurniturePaletteItem(QWidget):
    """Draggable furniture item shown in the palette."""

    def __init__(self, furniture_type: FurnitureType, width: int, height: int,
                 image_path: str, grid_cell_size: int = 40):
        super().__init__()
        self.furniture_type  = furniture_type
        self.furniture_width  = width
        self.furniture_height = height
        self.grid_cell_size   = grid_cell_size
        self.image_path       = image_path
        self.setFixedSize(100, 80)
        self._image = _load_image(image_path)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor(theme.PANEL_BG))

        cell = 20
        margin = 10
        rect = QRect(margin, margin,
                     self.furniture_width * cell,
                     self.furniture_height * cell)

        if self._image:
            scaled = self._image.scaled(rect.size(),
                                        Qt.AspectRatioMode.KeepAspectRatio,
                                        Qt.TransformationMode.SmoothTransformation)
            painter.drawPixmap(
                rect.x() + (rect.width()  - scaled.width())  // 2,
                rect.y() + (rect.height() - scaled.height()) // 2,
                scaled,
            )
        else:
            painter.setBrush(QBrush(QColor(theme.FURNITURE_FALLBACK)))
            painter.setPen(QPen(QColor(theme.FURNITURE_FALLBACK), 2))
            painter.drawRect(rect)

        painter.setPen(QPen(QColor("#000000")))
        painter.drawText(self.rect(),
                         Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignHCenter,
                         self.furniture_type.value)

    def _drag_pixmap(self) -> QPixmap:
        w = self.furniture_width  * self.grid_cell_size
        h = self.furniture_height * self.grid_cell_size
        px = QPixmap(w, h)
        px.fill(Qt.GlobalColor.transparent)
        painter = QPainter(px)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        if self._image:
            scaled = self._image.scaled(px.size(),
                                        Qt.AspectRatioMode.KeepAspectRatio,
                                        Qt.TransformationMode.SmoothTransformation)
            painter.drawPixmap((w - scaled.width()) // 2,
                               (h - scaled.height()) // 2, scaled)
        else:
            painter.setBrush(QBrush(QColor(theme.FURNITURE_FALLBACK)))
            painter.setPen(QPen(QColor(theme.FURNITURE_FALLBACK), 2))
            painter.drawRect(QRect(2, 2, w - 4, h - 4))
        painter.end()
        return px

    def mousePressEvent(self, event):
        if event.button() != Qt.MouseButton.LeftButton:
            return
        drag = QDrag(self)
        mime = QMimeData()
        mime.setText(
            f"{self.furniture_type.value},{self.furniture_width},"
            f"{self.furniture_height},{self.image_path}"
        )
        drag.setMimeData(mime)
        drag.setPixmap(self._drag_pixmap())
        drag.setHotSpot(QPoint(
            self.furniture_width  * self.grid_cell_size // 2,
            self.furniture_height * self.grid_cell_size // 2,
        ))
        drag.exec(Qt.DropAction.CopyAction)


class FurniturePalette(QWidget):
    """Scrollable list of available furniture types."""

    def __init__(self, grid_cell_size: int = 40):
        super().__init__()
        self.grid_cell_size = grid_cell_size
        self._init_ui()

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.setStyleSheet(f"background-color: {theme.PANEL_BG};")

        title = QLabel("Furniture Palette")
        title.setStyleSheet(
            f"font-weight: bold; font-size: 14px; padding: 10px;"
            f"color: {theme.PANEL_HEADER_COLOR};"
        )
        layout.addWidget(title)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        container = QWidget()
        container_layout = QVBoxLayout(container)
        container_layout.setAlignment(Qt.AlignmentFlag.AlignTop)

        container_layout.addWidget(FurniturePaletteItem(
            FurnitureType.SINGLE_DESK, 1, 1,
            image_path=DEFAULT_IMAGE_PATH,
            grid_cell_size=self.grid_cell_size,
        ))
        container_layout.addStretch()

        scroll.setWidget(container)
        layout.addWidget(scroll)


class ClassroomGrid(QWidget):
    """Grid canvas where furniture can be placed, moved, and deleted."""

    def __init__(self, grid_width: int = 20, grid_height: int = 15, cell_size: int = 40):
        super().__init__()
        self.grid_width      = grid_width
        self.grid_height     = grid_height
        self.cell_size       = cell_size
        self.furniture_list: List[Furniture] = []
        self.furniture_counter = 0

        self.selected_furniture:    Optional[Furniture]      = None
        self.drag_start_pos:        Optional[QPoint]          = None
        self.furniture_original_pos: Optional[Tuple[int, int]] = None

        self.setAcceptDrops(True)
        self.update_size()

    def update_size(self):
        self.setMinimumSize(self.grid_width * self.cell_size,
                            self.grid_height * self.cell_size)

    def set_cell_size(self, new_cell_size: int):
        self.cell_size = new_cell_size
        self.update_size()
        self.update()

    # ── painting ──────────────────────────────────────────────────────────────

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor(theme.GRID_BG))
        painter.setPen(QPen(QColor(theme.GRID_LINE), 1))
        for x in range(self.grid_width + 1):
            painter.drawLine(x * self.cell_size, 0,
                             x * self.cell_size, self.grid_height * self.cell_size)
        for y in range(self.grid_height + 1):
            painter.drawLine(0, y * self.cell_size,
                             self.grid_width * self.cell_size, y * self.cell_size)
        for f in self.furniture_list:
            self._draw_furniture(painter, f)

    def _draw_furniture(self, painter: QPainter, furniture: Furniture):
        x, y = furniture.position
        rect = QRect(x * self.cell_size + 2, y * self.cell_size + 2,
                     furniture.width  * self.cell_size - 4,
                     furniture.height * self.cell_size - 4)

        img = _load_image(furniture.image_path)
        if img:
            scaled = img.scaled(rect.size(),
                                Qt.AspectRatioMode.KeepAspectRatio,
                                Qt.TransformationMode.SmoothTransformation)
            painter.drawPixmap(
                rect.x() + (rect.width()  - scaled.width())  // 2,
                rect.y() + (rect.height() - scaled.height()) // 2,
                scaled,
            )
        else:
            painter.setBrush(QBrush(QColor(theme.FURNITURE_FALLBACK)))
            painter.setPen(QPen(QColor(theme.FURNITURE_FALLBACK), 2))
            painter.drawRect(rect)

        painter.setPen(QPen(QColor(theme.GRID_BG)))
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter,
                         furniture.furniture_id.split('_')[-1])

    # ── drag-and-drop from palette ────────────────────────────────────────────

    def dragEnterEvent(self, event):
        if event.mimeData().hasText():
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        event.acceptProposedAction()

    def dropEvent(self, event):
        if not event.mimeData().hasText():
            return
        data   = event.mimeData().text().split(',')
        ftype  = FurnitureType(data[0])
        width  = int(data[1])
        height = int(data[2])
        image  = data[3]

        pos   = event.position().toPoint()
        gx    = pos.x() // self.cell_size
        gy    = pos.y() // self.cell_size

        if (gx + width  > self.grid_width or
                gy + height > self.grid_height or
                self._collision(gx, gy, width, height)):
            event.acceptProposedAction()
            return

        fid = f"{ftype.value}_{self.furniture_counter}"
        self.furniture_counter += 1
        self.furniture_list.append(Furniture(
            furniture_id=fid, furniture_type=ftype,
            position=(gx, gy), width=width, height=height,
            image_path=image,
        ))
        self.update()
        event.acceptProposedAction()

    def _collision(self, x: int, y: int, w: int, h: int,
                   exclude: Optional[Furniture] = None) -> bool:
        new_cells = {(x + dx, y + dy) for dx in range(w) for dy in range(h)}
        for f in self.furniture_list:
            if f is exclude:
                continue
            if new_cells & set(f.get_occupied_cells()):
                return True
        return False

    # ── mouse: move existing furniture ───────────────────────────────────────

    def mousePressEvent(self, event):
        if event.button() != Qt.MouseButton.LeftButton:
            return
        gx = event.position().toPoint().x() // self.cell_size
        gy = event.position().toPoint().y() // self.cell_size
        for f in reversed(self.furniture_list):
            if (gx, gy) in f.get_occupied_cells():
                self.selected_furniture     = f
                self.drag_start_pos         = event.position().toPoint()
                self.furniture_original_pos = f.position
                self.setFocus()
                break

    def mouseMoveEvent(self, event):
        if not self.selected_furniture or not self.drag_start_pos:
            return
        cur = event.position().toPoint()
        dx = (cur.x() - self.drag_start_pos.x()) // self.cell_size
        dy = (cur.y() - self.drag_start_pos.y()) // self.cell_size
        nx = self.furniture_original_pos[0] + dx
        ny = self.furniture_original_pos[1] + dy
        f  = self.selected_furniture
        if (0 <= nx and nx + f.width  <= self.grid_width and
                0 <= ny and ny + f.height <= self.grid_height and
                not self._collision(nx, ny, f.width, f.height, exclude=f)):
            f.position = (nx, ny)
            self.update()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.selected_furniture     = None
            self.drag_start_pos         = None
            self.furniture_original_pos = None

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Delete and self.selected_furniture:
            self.furniture_list.remove(self.selected_furniture)
            self.selected_furniture = None
            self.update()

    # ── public API ────────────────────────────────────────────────────────────

    def get_furniture_list(self) -> List[Furniture]:
        return self.furniture_list

    def clear(self):
        self.furniture_list.clear()
        self.furniture_counter = 0
        self.selected_furniture = None
        self.update()


class ClassroomBuilderWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.cell_size = 40
        self.current_classroom_name: Optional[str] = None
        self._init_ui()

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setStyleSheet(theme.toolbar_stylesheet())
        tb = QHBoxLayout(toolbar)
        tb.setContentsMargins(6, 4, 6, 4)
        tb.setSpacing(6)

        save_btn = QPushButton("Save Classroom")
        save_btn.clicked.connect(self.save_classroom)
        tb.addWidget(save_btn)

        load_btn = QPushButton("Load Classroom")
        load_btn.clicked.connect(self.load_classroom)
        tb.addWidget(load_btn)

        clear_btn = QPushButton("Clear Classroom")
        clear_btn.clicked.connect(self.clear_classroom)
        tb.addWidget(clear_btn)

        tb.addStretch()

        cell_size_label = QLabel("Cell Size:")
        tb.addWidget(cell_size_label)

        self.cell_size_spin = QSpinBox()
        self.cell_size_spin.setRange(CELL_SIZE_MIN, CELL_SIZE_MAX)
        self.cell_size_spin.setSingleStep(5)
        self.cell_size_spin.setValue(BASE_CELL_SIZE)
        self.cell_size_spin.setFixedWidth(60)
        self.cell_size_spin.setToolTip(
            "Display size of each grid cell (pixels).\n"
            "Smaller = see more of the grid; larger = easier to place furniture."
        )
        self.cell_size_spin.valueChanged.connect(self.set_cell_size)
        tb.addWidget(self.cell_size_spin)

        self.name_label = QLabel("Unsaved Classroom")
        self.name_label.setStyleSheet(f"font-weight: bold; color: {theme.TOOLBAR_TEXT};")
        tb.addWidget(self.name_label)

        layout.addWidget(toolbar)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        self.palette = FurniturePalette(grid_cell_size=self.cell_size)
        splitter.addWidget(self.palette)

        self.classroom_grid = ClassroomGrid(20, 15, self.cell_size)
        splitter.addWidget(self.classroom_grid)
        splitter.setSizes([200, 800])
        layout.addWidget(splitter)

    # ── actions ───────────────────────────────────────────────────────────────

    def save_classroom(self):
        if not self.classroom_grid.furniture_list:
            QMessageBox.warning(self, "Empty Classroom",
                                "Add some furniture before saving.")
            return

        if not self.current_classroom_name:
            name, ok = QInputDialog.getText(self, "Save Classroom",
                                            "Enter a name for this classroom:")
            if not ok or not name.strip():
                return
            self.current_classroom_name = name.strip()

        # Confirm overwrite if the file already exists
        filepath = Path("data/classrooms") / f"{self.current_classroom_name}.json"
        if filepath.exists():
            reply = QMessageBox.question(
                self, "Overwrite?",
                f"A classroom named \"{self.current_classroom_name}\" already exists.\n"
                "Overwrite it?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        classroom = Classroom(self.current_classroom_name,
                              self.classroom_grid.grid_width,
                              self.classroom_grid.grid_height)
        for f in self.classroom_grid.get_furniture_list():
            classroom.add_furniture(f)

        try:
            classroom.save_to_file()
            self.name_label.setText(f"Classroom: {self.current_classroom_name}")
            QMessageBox.information(self, "Saved",
                                    f"Classroom \"{self.current_classroom_name}\" saved.")
        except Exception as e:
            QMessageBox.critical(self, "Save Failed",
                                 f"Could not save classroom:\n{e}")

    def load_classroom(self):
        saved = Classroom.list_saved_classrooms()
        if not saved:
            QMessageBox.information(self, "No Classrooms",
                                    "No saved classrooms found.")
            return

        name, ok = QInputDialog.getItem(self, "Load Classroom",
                                        "Select a classroom:", saved, 0, False)
        if not ok or not name:
            return

        try:
            filepath = Path("data/classrooms") / f"{name}.json"
            classroom = Classroom.load_from_file(filepath)
        except Exception as e:
            QMessageBox.critical(self, "Load Failed",
                                 f"Could not load \"{name}\":\n{e}")
            return

        self.classroom_grid.clear()
        for f in classroom.furniture:
            self.classroom_grid.furniture_list.append(f)
        self.classroom_grid.furniture_counter = len(classroom.furniture)
        self.classroom_grid.update()

        self.current_classroom_name = name
        self.name_label.setText(f"Classroom: {name}")

    def clear_classroom(self):
        if self.classroom_grid.furniture_list:
            reply = QMessageBox.question(
                self, "Clear Classroom",
                "Remove all furniture from the classroom?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        self.classroom_grid.clear()
        self.current_classroom_name = None
        self.name_label.setText("Unsaved Classroom")

    def set_cell_size(self, new_cell_size: int):
        self.cell_size = new_cell_size
        self.classroom_grid.set_cell_size(new_cell_size)

    def get_classroom_furniture(self) -> List[Furniture]:
        return self.classroom_grid.get_furniture_list()
