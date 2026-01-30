from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QPushButton, 
                              QLabel, QFileDialog, QMessageBox)
from PyQt6.QtCore import Qt, pyqtSignal
from typing import List

from src.models.student import Student
from src.io.csv_handler import StudentImporter


class SetupWidget(QWidget):
    # Signal to notify when students are imported
    students_imported = pyqtSignal(list)
    
    def __init__(self):
        super().__init__()
        self.students: List[Student] = []
        self.importer = StudentImporter()
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Import button
        self.import_button = QPushButton("Import Student List (CSV)")
        self.import_button.clicked.connect(self.import_students)
        
        # Student count label
        self.student_count_label = QLabel("No students loaded")
        self.student_count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        layout.addWidget(self.import_button)
        layout.addWidget(self.student_count_label)
        layout.addStretch()
    
    def import_students(self):
        """Open file dialog and import students from CSV"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select Student List CSV",
            "data/students",
            "CSV Files (*.csv);;All Files (*)"
        )
        
        if file_path:
            try:
                # Import students
                self.students = self.importer.import_from_csv(file_path)
                
                # Update UI
                self.student_count_label.setText(
                    f"✓ Loaded {len(self.students)} students"
                )
                
                # Emit signal so other parts of the app know
                self.students_imported.emit(self.students)
                
                # Show success message
                QMessageBox.information(
                    self,
                    "Success",
                    f"Successfully imported {len(self.students)} students!"
                )
                
                # Debug print
                print("\nImported Students:")
                for student in self.students:
                    print(f"  {student.name} (ID: {student.id})")
                
            except Exception as e:
                QMessageBox.critical(
                    self,
                    "Error",
                    f"Failed to import students:\n{str(e)}"
                )
    
    def get_students(self) -> List[Student]:
        """Return the current student list"""
        return self.students