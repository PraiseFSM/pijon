from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                              QScrollArea, QPushButton, QSplitter, QInputDialog,
                              QMessageBox, QFileDialog)
from PyQt6.QtCore import Qt, QMimeData, QPoint, QRect
from PyQt6.QtGui import QPainter, QColor, QDrag, QPen, QBrush, QPixmap
from typing import List, Optional, Tuple
from pathlib import Path
from src.models.classroom import Classroom


from src.models.furniture import Furniture, SingleDesk, FurnitureType



# Image paths
#FURNITURE_IMAGE_DIR = Path("data/furniture_images")
background_color = "#F5F5F5"
default_furniture_color = "#4CAF50"
grid_line_color = "#E0E0E0"
default_image_path = "data/furniture_images/default_desk.png"


class FurniturePaletteItem(QWidget):
    """A draggable furniture item in the palette"""
    
    def __init__(self, furniture_type: FurnitureType, width: int, height: int, image_path: str, grid_cell_size: int = 40):
        super().__init__()
        self.furniture_type = furniture_type
        self.furniture_width = width
        self.furniture_height = height
        self.grid_cell_size = grid_cell_size
        self.setFixedSize(100, 80)
        self.image_path = image_path
        
        # Load furniture image
        self.furniture_image = self.load_furniture_image()
    
    def load_furniture_image(self) -> Optional[QPixmap]:
        """Load the furniture image from disk"""
        image_path = self.image_path
        if image_path:
            pixmap = QPixmap(str(image_path))
            if not pixmap.isNull():
                return pixmap
            else:
                print(f"Warning: Failed to load image from {image_path}")
        else:
            print(f"Warning: No image found for {self.furniture_type.value}")
        
        return None
    
    def paintEvent(self, event):
        """Draw the furniture on the pallette"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Background
        painter.fillRect(self.rect(), QColor(background_color))
        
        palette_cell_size = 20
        margin = 10
        
        furniture_rect = QRect(
            margin, 
            margin, 
            self.furniture_width * palette_cell_size, 
            self.furniture_height * palette_cell_size
        )
        
        # Draw image if available, otherwise fall back to colored rectangle
        if self.furniture_image:
            # Scale image to fit the furniture rect
            scaled_image = self.furniture_image.scaled(
                furniture_rect.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            
            # Center the image in the furniture rect
            x_offset = furniture_rect.x() + (furniture_rect.width() - scaled_image.width()) // 2
            y_offset = furniture_rect.y() + (furniture_rect.height() - scaled_image.height()) // 2
            
            painter.drawPixmap(x_offset, y_offset, scaled_image)
        else:
            # Fallback: draw colored rectangle
            painter.setBrush(QBrush(QColor(default_furniture_color)))
            painter.setPen(QPen(QColor(default_furniture_color), 2))
            painter.drawRect(furniture_rect)
        
        # Label
        painter.setPen(QPen(QColor("#000000")))
        painter.drawText(self.rect(), Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignHCenter, 
                        self.furniture_type.value)
    
    def create_drag_pixmap(self) -> QPixmap:
        """Create a pixmap for the drag preview at actual grid size"""
        pixmap_width = self.furniture_width * self.grid_cell_size
        pixmap_height = self.furniture_height * self.grid_cell_size
        
        pixmap = QPixmap(pixmap_width, pixmap_height)
        pixmap.fill(Qt.GlobalColor.transparent)
        
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        
        if self.furniture_image:
            # Scale image to grid size
            scaled_image = self.furniture_image.scaled(
                pixmap.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            
            # Center the image
            x_offset = (pixmap_width - scaled_image.width()) // 2
            y_offset = (pixmap_height - scaled_image.height()) // 2
            
            painter.drawPixmap(x_offset, y_offset, scaled_image)
        else:
            # Fallback: draw colored rectangle
            rect = QRect(2, 2, pixmap_width - 4, pixmap_height - 4)
            painter.setBrush(QBrush(QColor(default_furniture_color)))
            painter.setPen(QPen(QColor(default_furniture_color), 2))
            painter.drawRect(rect)
        
        painter.end()
        return pixmap
    
    def mousePressEvent(self, event):
        """Start drag operation"""
        if event.button() == Qt.MouseButton.LeftButton:
            drag = QDrag(self)
            mime_data = QMimeData()
            
            mime_data.setText(f"{self.furniture_type.value},{self.furniture_width},{self.furniture_height},{self.image_path}")
            drag.setMimeData(mime_data)
            
            pixmap = self.create_drag_pixmap()
            drag.setPixmap(pixmap)
            
            hotspot_x = (self.furniture_width * self.grid_cell_size) // 2
            hotspot_y = (self.furniture_height * self.grid_cell_size) // 2
            drag.setHotSpot(QPoint(hotspot_x, hotspot_y))
            
            drag.exec(Qt.DropAction.CopyAction)


class FurniturePalette(QWidget):
    """Scrollable list of available furniture"""
    
    def __init__(self, grid_cell_size: int = 40):
        super().__init__()
        self.grid_cell_size = grid_cell_size  # Store grid cell size
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Title
        title = QLabel("Furniture Palette")
        title.setStyleSheet("font-weight: bold; font-size: 14px; padding: 10px;")
        layout.addWidget(title)
        
        # Scrollable area
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        
        # Container for furniture items
        container = QWidget()
        container_layout = QVBoxLayout(container)
        container_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        
        # Add default furniture items (passing grid_cell_size)
        #     def __init__(self, furniture_type: FurnitureType, width: int, height: int, image_path: str, grid_cell_size: int = 40):
        single_desk = FurniturePaletteItem(
            FurnitureType.SINGLE_DESK, 
            width=1, 
            height=1,
            image_path = default_image_path,
            grid_cell_size=self.grid_cell_size
        )
        container_layout.addWidget(single_desk)
        
        #TODO add importing of furniture types, upload image, give it a width and height
        # You can add more furniture types here later
        # table = FurniturePaletteItem(FurnitureType.TABLE, 2, 2, self.grid_cell_size)
        # container_layout.addWidget(table)
        
        container_layout.addStretch()
        
        scroll.setWidget(container)
        layout.addWidget(scroll)
    
    def update_grid_cell_size(self, new_cell_size: int):
        """Update when grid cell size changes (for future zoom functionality)"""
        self.grid_cell_size = new_cell_size
        # TODO: Recreate palette items with new cell size
        # For now, you'd need to rebuild the palette when zoom changes


class ClassroomGrid(QWidget):
    """The main classroom grid where furniture can be placed"""
    
    def __init__(self, grid_width: int = 20, grid_height: int = 15, cell_size: int = 40):
        super().__init__()
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.cell_size = cell_size  # Now a parameter, not hardcoded!
        self.furniture_list: List[Furniture] = []
        self.furniture_counter = 0
        
        # Enable drag and drop
        self.setAcceptDrops(True)

        # temp variables For dragging furniture around
        self.selected_furniture: Optional[Furniture] = None
        self.drag_start_pos: Optional[QPoint] = None
        self.furniture_original_pos: Optional[Tuple[int, int]] = None
        
        # Set minimum size
        self.update_size()
        
    
    def update_size(self):
        """Update widget size based on grid dimensions and cell size"""
        self.setMinimumSize(
            self.grid_width * self.cell_size,
            self.grid_height * self.cell_size
        )
    
    def set_cell_size(self, new_cell_size: int):
        """Change the cell size (for zoom functionality)"""
        self.cell_size = new_cell_size
        self.update_size()
        self.update()  # Repaint
    
    
    def paintEvent(self, event):
        """Draw the grid and furniture"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # Draw background
        painter.fillRect(self.rect(), QColor(background_color))
        
        # Draw grid lines
        painter.setPen(QPen(QColor(grid_line_color), 1))
        
        # Vertical lines
        for x in range(self.grid_width + 1):
            x_pos = x * self.cell_size
            painter.drawLine(x_pos, 0, x_pos, self.grid_height * self.cell_size)
        
        # Horizontal lines
        for y in range(self.grid_height + 1):
            y_pos = y * self.cell_size
            painter.drawLine(0, y_pos, self.grid_width * self.cell_size, y_pos)
        
        # Draw furniture
        for furniture in self.furniture_list:
            self.draw_furniture(painter, furniture)
    
    def draw_furniture(self, painter: QPainter, furniture: Furniture):
        """Draw a furniture piece on the grid"""
        x, y = furniture.position
        
        furniture_rect = QRect(
            x * self.cell_size + 2,
            y * self.cell_size + 2,
            furniture.width * self.cell_size - 4,
            furniture.height * self.cell_size - 4
        )
        
    
        # Different colors for different furniture types
        if furniture.image_path:
            # Scale image to fit the furniture rect
            furniture_image = self.load_furniture_image(furniture.image_path)
            scaled_image = furniture_image.scaled(
                furniture_rect.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            
            # Center the image in the furniture rect
            x_offset = furniture_rect.x() + (furniture_rect.width() - scaled_image.width()) // 2
            y_offset = furniture_rect.y() + (furniture_rect.height() - scaled_image.height()) // 2
            
            painter.drawPixmap(x_offset, y_offset, scaled_image)
        else:
            # Fallback: draw colored rectangle
            painter.setBrush(QBrush(QColor(default_furniture_color)))
            painter.setPen(QPen(QColor(default_furniture_color), 2))
            painter.drawRect(furniture_rect)
        
      
        # Draw furniture ID
        painter.setPen(QPen(QColor(background_color)))
        painter.drawText(furniture_rect, Qt.AlignmentFlag.AlignCenter, furniture.furniture_id.split('_')[-1])
    

    def load_furniture_image(self, image_path) -> Optional[QPixmap]:
        """Load the furniture image from disk"""
        image_path = image_path
        if image_path:
            pixmap = QPixmap(str(image_path))
            if not pixmap.isNull():
                return pixmap
            else:
                print(f"Warning: Failed to load image from {image_path}")
        else:
            print(f"Warning: No image found for {image_path}")
        
        return None
    

    def dragEnterEvent(self, event):
        """Accept drag events"""
        if event.mimeData().hasText():
            event.acceptProposedAction()
    
    def dragMoveEvent(self, event):
        """Update during drag"""
        event.acceptProposedAction()
    
    def dropEvent(self, event):
        """Handle furniture drop"""
        if event.mimeData().hasText():
            # Parse furniture info from mime data
            print({event.mimeData().text()})
            data = event.mimeData().text().split(',')
            furniture_type_str = data[0]
            width = int(data[1])
            height = int(data[2])
            image_path = data[3]
            
            # Convert drop position to grid coordinates
            drop_pos = event.position().toPoint()
            grid_x = drop_pos.x() // self.cell_size
            grid_y = drop_pos.y() // self.cell_size
            
            # Ensure within bounds
            if grid_x + width <= self.grid_width and grid_y + height <= self.grid_height:
                # Check for collision with existing furniture
                if not self.check_collision(grid_x, grid_y, width, height):
                    # Create furniture
                    furniture_type = FurnitureType(furniture_type_str)
                    furniture_id = f"{furniture_type_str}_{self.furniture_counter}"
                    self.furniture_counter += 1

                    furniture = Furniture(furniture_id=furniture_id,
                            furniture_type=furniture_type,
                            position=(grid_x, grid_y),
                            width=width,
                            height=height,
                            image_path=image_path)
                    
                    self.furniture_list.append(furniture)
                    self.update()
                    
                    print(f"Added {furniture_id} at ({grid_x}, {grid_y})")
                else:
                    print("Collision detected - furniture not placed")
            
            event.acceptProposedAction()
    
    def check_collision(self, x: int, y: int, width: int, height: int) -> bool:
        """Check if placing furniture here would collide with existing furniture"""
        new_cells = set()
        for dx in range(width):
            for dy in range(height):
                new_cells.add((x + dx, y + dy))
        
        for furniture in self.furniture_list:
            existing_cells = set(furniture.get_occupied_cells())
            if new_cells & existing_cells:
                return True
        
        return False
    
    def get_furniture_list(self) -> List[Furniture]:
        """Return list of all furniture in the classroom"""
        return self.furniture_list
    
    def clear_classroom(self):
        """Remove all furniture"""
        self.furniture_list.clear()
        self.update()

    def mousePressEvent(self, event):
        """Handle mouse press - select furniture to move"""
        if event.button() == Qt.MouseButton.LeftButton:
            # Convert to grid coordinates
            grid_x = event.position().toPoint().x() // self.cell_size
            grid_y = event.position().toPoint().y() // self.cell_size
            
            # Find furniture at this position
            for furniture in reversed(self.furniture_list):  # Check top furniture first
                if (grid_x, grid_y) in furniture.get_occupied_cells():
                    self.selected_furniture = furniture
                    self.drag_start_pos = event.position().toPoint()
                    self.furniture_original_pos = furniture.position
                    print(f"Selected {furniture.furniture_id}")
                    break
    
    def mouseMoveEvent(self, event):
        """Handle mouse move - drag furniture"""
        if self.selected_furniture and self.drag_start_pos:
            # Calculate new position
            current_pos = event.position().toPoint()
            delta_x = (current_pos.x() - self.drag_start_pos.x()) // self.cell_size
            delta_y = (current_pos.y() - self.drag_start_pos.y()) // self.cell_size
            
            new_x = self.furniture_original_pos[0] + delta_x
            new_y = self.furniture_original_pos[1] + delta_y
            
            # Check bounds
            if (0 <= new_x and 
                new_x + self.selected_furniture.width <= self.grid_width and
                0 <= new_y and 
                new_y + self.selected_furniture.height <= self.grid_height):
                
                # Temporarily move furniture to check collision
                old_pos = self.selected_furniture.position
                self.selected_furniture.position = (new_x, new_y)
                
                # Check collision with other furniture
                collision = False
                for furniture in self.furniture_list:
                    if furniture is not self.selected_furniture:
                        if set(self.selected_furniture.get_occupied_cells()) & set(furniture.get_occupied_cells()):
                            collision = True
                            break
                
                if collision:
                    # Revert position
                    self.selected_furniture.position = old_pos
                else:
                    # Keep new position and repaint
                    self.update()
    
    def mouseReleaseEvent(self, event):
        """Handle mouse release - finish dragging"""
        if event.button() == Qt.MouseButton.LeftButton:
            if self.selected_furniture:
                print(f"Moved {self.selected_furniture.furniture_id} to {self.selected_furniture.position}")
                self.selected_furniture = None
                self.drag_start_pos = None
                self.furniture_original_pos = None
                self.update()
    
    def keyPressEvent(self, event):
        """Handle keyboard - delete selected furniture"""
        if event.key() == Qt.Key.Key_Delete and self.selected_furniture:
            self.furniture_list.remove(self.selected_furniture)
            print(f"Deleted {self.selected_furniture.furniture_id}")
            self.selected_furniture = None
            self.update()


class ClassroomBuilderWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.cell_size = 40
        self.current_classroom_name = None
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Top toolbar
        toolbar_layout = QHBoxLayout()
        
        save_btn = QPushButton("Save Classroom")
        save_btn.clicked.connect(self.save_classroom)
        toolbar_layout.addWidget(save_btn)
        
        load_btn = QPushButton("Load Classroom")
        load_btn.clicked.connect(self.load_classroom)
        toolbar_layout.addWidget(load_btn)
        
        clear_btn = QPushButton("Clear Classroom")
        clear_btn.clicked.connect(self.clear_classroom)
        toolbar_layout.addWidget(clear_btn)
        
        toolbar_layout.addStretch()
        
        # Classroom name label
        self.name_label = QLabel("Unsaved Classroom")
        self.name_label.setStyleSheet("font-weight: bold;")
        toolbar_layout.addWidget(self.name_label)
        
        layout.addLayout(toolbar_layout)
        
        # Splitter for resizable panels
        splitter = QSplitter(Qt.Orientation.Horizontal)
        
        self.palette = FurniturePalette(grid_cell_size=self.cell_size)
        splitter.addWidget(self.palette)
        
        self.classroom_grid = ClassroomGrid(
            grid_width=20, 
            grid_height=15, 
            cell_size=self.cell_size
        )
        splitter.addWidget(self.classroom_grid)
        
        splitter.setSizes([200, 800])
        layout.addWidget(splitter)
    
    def save_classroom(self):
        """Save the current classroom layout"""
        # Get classroom name
        if not self.current_classroom_name:
            name, ok = QInputDialog.getText(
                self,
                "Save Classroom",
                "Enter classroom name:"
            )
            
            if not ok or not name:
                return
            
            self.current_classroom_name = name
        
        # Create Classroom object
        classroom = Classroom(
            name=self.current_classroom_name,
            grid_width=self.classroom_grid.grid_width,
            grid_height=self.classroom_grid.grid_height
        )
        
        # Add all furniture
        for furniture in self.classroom_grid.get_furniture_list():
            classroom.add_furniture(furniture)
        
        # Save to file
        try:
            filepath = classroom.save_to_file()
            self.name_label.setText(f"Classroom: {self.current_classroom_name}")
            
            QMessageBox.information(
                self,
                "Success",
                f"Classroom saved to {filepath}"
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Error",
                f"Failed to save classroom:\n{str(e)}"
            )
    
    def load_classroom(self):
        """Load a classroom layout from file"""
        # Get list of saved classrooms
        saved_classrooms = Classroom.list_saved_classrooms()
        
        if not saved_classrooms:
            QMessageBox.information(
                self,
                "No Classrooms",
                "No saved classrooms found."
            )
            return
        
        # Let user choose
        name, ok = QInputDialog.getItem(
            self,
            "Load Classroom",
            "Select classroom to load:",
            saved_classrooms,
            0,
            False
        )
        
        if not ok or not name:
            return
        
        # Load classroom
        try:
            filepath = Path("data/classrooms") / f"{name}.json"
            classroom = Classroom.load_from_file(filepath)
            
            # Clear current grid
            self.classroom_grid.clear_classroom()
            
            # Load furniture
            for furniture in classroom.furniture:
                self.classroom_grid.furniture_list.append(furniture)
            
            self.classroom_grid.furniture_counter = len(classroom.furniture)
            self.classroom_grid.update()
            
            self.current_classroom_name = name
            self.name_label.setText(f"Classroom: {name}")
            
            QMessageBox.information(
                self,
                "Success",
                f"Loaded classroom: {name}"
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Error",
                f"Failed to load classroom:\n{str(e)}"
            )
    
    def clear_classroom(self):
        """Clear all furniture from classroom"""
        self.classroom_grid.clear_classroom()
        self.current_classroom_name = None
        self.name_label.setText("Unsaved Classroom")
        print("Classroom cleared")
    
    def set_cell_size(self, new_cell_size: int):
        """Update cell size for zoom functionality (future feature)"""
        self.cell_size = new_cell_size
        self.classroom_grid.set_cell_size(new_cell_size)
        self.palette.update_grid_cell_size(new_cell_size)
    
    def get_classroom_furniture(self) -> List[Furniture]:
        """Get all furniture currently in the classroom"""
        return self.classroom_grid.get_furniture_list()