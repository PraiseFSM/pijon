from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QLabel, QListWidget,
                              QListWidgetItem, QFileDialog, QMessageBox, QPushButton,
                              QDialog)
from PyQt6.QtCore import Qt
from typing import List

from src.models.student import Student
from src.io.csv_handler import StudentImporter
from src.ui.dialogs import StudentOptionsDialog
from src.ui import theme


class StudentListWidget(QWidget):
    """Scrollable list of students with import button."""

    def __init__(self):
        super().__init__()
        self.students: List[Student] = []
        self.importer = StudentImporter()
        self._init_ui()

    def _init_ui(self):
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
        self.count_label.setStyleSheet(
            f"padding: 5px 10px; color: {theme.PANEL_HEADER_COLOR};"
        )
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
        self.student_list.itemDoubleClicked.connect(self._on_student_double_clicked)
        layout.addWidget(self.student_list)

        import_btn = QPushButton("Import Student List (CSV)")
        import_btn.clicked.connect(self.import_students)
        layout.addWidget(import_btn)

    def _on_student_double_clicked(self, item: QListWidgetItem):
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
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Select Student List CSV", "data/students",
            "CSV Files (*.csv);;All Files (*)"
        )
        if not file_path:
            return
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
            QMessageBox.critical(self, "Import Failed",
                                 f"Failed to import students:\n{e}")

    def update_list(self):
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
