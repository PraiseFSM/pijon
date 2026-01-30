from PyQt6.QtWidgets import QWidget, QVBoxLayout, QLabel
from typing import List
from src.models.student import Student

class StudentPlacerWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.students: List[Student] = []
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        self.label = QLabel("Student Placer - Coming Soon!")
        layout.addWidget(self.label)
    
    def set_students(self, students: List[Student]):
        """Receive students from setup widget"""
        self.students = students
        self.label.setText(f"Ready to place {len(students)} students")
        print(f"Student placer received {len(students)} students")