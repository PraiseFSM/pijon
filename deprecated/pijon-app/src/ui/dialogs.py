from PyQt6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
                              QLabel, QPushButton, QLineEdit, QDoubleSpinBox,
                              QComboBox, QTableWidget, QTableWidgetItem,
                              QHeaderView, QDialogButtonBox, QMessageBox, QListWidget)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QColor
from typing import List, Optional, Tuple, Type

from src.models.student import Student
from src.models.preference import Preference, PreferenceTargetType
from src.algorithm.allocator import BaseAllocator, BogoAllocator, GreedyAllocator
from src.utils import mirror_student_preference, remove_mirror_preference


# Registry of available algorithms: (display name, description, class)
ALLOCATOR_OPTIONS: List[Tuple[str, str, Type[BaseAllocator]]] = [
    (
        "Greedy (Recommended)",
        "Places the most-constrained students first, assigning each to the seat with the "
        "lowest cost given current placements. Respects avoid/prefer preferences and fixtures.",
        GreedyAllocator,
    ),
    (
        "Bogo (Random)",
        "Randomly assigns students to seats. No constraint awareness — useful as a baseline.",
        BogoAllocator,
    ),
]


class AlgorithmSelectionDialog(QDialog):
    """Dialog for choosing a seating allocation algorithm"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Select Allocation Algorithm")
        self.setMinimumWidth(400)
        self._selected_class: Type[BaseAllocator] = ALLOCATOR_OPTIONS[0][2]
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)

        layout.addWidget(QLabel("Choose an algorithm:"))

        self.list_widget = QListWidget()
        for name, _, _ in ALLOCATOR_OPTIONS:
            self.list_widget.addItem(name)
        self.list_widget.setCurrentRow(0)
        self.list_widget.currentRowChanged.connect(self.on_selection_changed)
        layout.addWidget(self.list_widget)

        self.description_label = QLabel(ALLOCATOR_OPTIONS[0][1])
        self.description_label.setWordWrap(True)
        self.description_label.setStyleSheet("color: #555; font-style: italic; padding: 6px 0;")
        layout.addWidget(self.description_label)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok |
            QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def on_selection_changed(self, row: int):
        if 0 <= row < len(ALLOCATOR_OPTIONS):
            _, description, cls = ALLOCATOR_OPTIONS[row]
            self.description_label.setText(description)
            self._selected_class = cls

    def get_allocator(self) -> BaseAllocator:
        return self._selected_class()


class StudentOptionsDialog(QDialog):
    """Dialog for managing student options (rename, delete, preferences)"""
    
    def __init__(self, student: Student, all_students: List[Student], parent=None):
        super().__init__(parent)
        self.student = student
        self.all_students = all_students
        self.setWindowTitle(f"Options for {student.name}")
        self.setMinimumWidth(500)
        self.init_ui()
    
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Student info section
        info_layout = QFormLayout()
        
        self.name_field = QLineEdit(self.student.name)
        info_layout.addRow("Name:", self.name_field)
        
        id_label = QLabel(self.student.id)
        id_label.setStyleSheet("color: #666;")
        info_layout.addRow("ID:", id_label)
        
        layout.addLayout(info_layout)
        
        # Preferences section
        layout.addWidget(QLabel("Preferences:"))
        
        self.prefs_table = QTableWidget()
        self.prefs_table.setColumnCount(3)
        self.prefs_table.setHorizontalHeaderLabels(["Target", "Type", "Weight"])
        self.prefs_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.prefs_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.update_prefs_table()
        layout.addWidget(self.prefs_table)
        
        # Preference buttons
        pref_btn_layout = QHBoxLayout()
        
        add_pref_btn = QPushButton("Add Preference")
        add_pref_btn.clicked.connect(self.add_preference)
        pref_btn_layout.addWidget(add_pref_btn)
        
        edit_pref_btn = QPushButton("Edit Selected")
        edit_pref_btn.clicked.connect(self.edit_preference)
        pref_btn_layout.addWidget(edit_pref_btn)
        
        remove_pref_btn = QPushButton("Remove Selected")
        remove_pref_btn.clicked.connect(self.remove_preference)
        pref_btn_layout.addWidget(remove_pref_btn)
        
        layout.addLayout(pref_btn_layout)
        
        # Dialog buttons
        button_layout = QHBoxLayout()
        
        delete_student_btn = QPushButton("Delete Student")
        delete_student_btn.setStyleSheet("background-color: #f44336; color: white;")
        delete_student_btn.clicked.connect(self.delete_student)
        button_layout.addWidget(delete_student_btn)
        
        button_layout.addStretch()
        
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | 
            QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        button_layout.addWidget(buttons)
        
        layout.addLayout(button_layout)
    
    def update_prefs_table(self):
        """Update the preferences table"""
        self.prefs_table.setRowCount(len(self.student.preferences))
        
        for i, pref in enumerate(self.student.preferences):
            target_name = pref.target_id
            if pref.target_type == PreferenceTargetType.STUDENT:
                for s in self.all_students:
                    if s.id == pref.target_id:
                        target_name = s.name
                        break
            
            self.prefs_table.setItem(i, 0, QTableWidgetItem(target_name))
            self.prefs_table.setItem(i, 1, QTableWidgetItem(pref.target_type.value))
            self.prefs_table.setItem(i, 2, QTableWidgetItem(str(pref.weight)))
    
    def add_preference(self):
        dialog = PreferenceEditDialog(None, self.all_students, self.student, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            pref = dialog.get_preference()
            self.student.add_preference(pref)
            if pref.target_type == PreferenceTargetType.STUDENT:
                target = next((s for s in self.all_students if s.id == pref.target_id), None)
                if target:
                    mirror_student_preference(self.student, target, pref.weight)
            self.update_prefs_table()

    def edit_preference(self):
        row = self.prefs_table.currentRow()
        if row < 0:
            QMessageBox.warning(self, "No Selection", "Please select a preference to edit.")
            return

        old_pref = self.student.preferences[row]
        dialog = PreferenceEditDialog(old_pref, self.all_students, self.student, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            new_pref = dialog.get_preference()
            # Remove old mirror if student target changed
            if (old_pref.target_type == PreferenceTargetType.STUDENT and
                    old_pref.target_id != new_pref.target_id):
                remove_mirror_preference(self.student, old_pref.target_id, self.all_students)
            self.student.preferences[row] = new_pref
            if new_pref.target_type == PreferenceTargetType.STUDENT:
                target = next((s for s in self.all_students if s.id == new_pref.target_id), None)
                if target:
                    mirror_student_preference(self.student, target, new_pref.weight)
            self.update_prefs_table()

    def remove_preference(self):
        row = self.prefs_table.currentRow()
        if row < 0:
            QMessageBox.warning(self, "No Selection", "Please select a preference to remove.")
            return

        pref = self.student.preferences[row]
        if pref.target_type == PreferenceTargetType.STUDENT:
            remove_mirror_preference(self.student, pref.target_id, self.all_students)
        self.student.preferences.pop(row)
        self.update_prefs_table()
    
    def delete_student(self):
        """Mark student for deletion"""
        reply = QMessageBox.question(
            self,
            "Confirm Delete",
            f"Are you sure you want to delete {self.student.name}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
            self.done(2)  # Custom return code for deletion
    
    def get_updated_name(self) -> str:
        """Get the updated student name"""
        return self.name_field.text()


class PreferenceEditDialog(QDialog):
    """Dialog for editing a single preference"""
    
    def __init__(self, preference: Optional[Preference], all_students: List[Student], 
                 current_student: Student, parent=None):
        super().__init__(parent)
        self.preference = preference
        self.all_students = all_students
        self.current_student = current_student
        self.setWindowTitle("Edit Preference" if preference else "Add Preference")
        self.init_ui()
    
    def init_ui(self):
        layout = QFormLayout(self)
        
        # Target type
        self.type_combo = QComboBox()
        self.type_combo.addItems(["Student", "Furniture"])
        self.type_combo.currentTextChanged.connect(self.on_type_changed)
        layout.addRow("Target Type:", self.type_combo)
        
        # Target selection
        self.target_combo = QComboBox()
        layout.addRow("Target:", self.target_combo)
        
        # Weight
        self.weight_spin = QDoubleSpinBox()
        self.weight_spin.setRange(-1000, 1000)
        self.weight_spin.setValue(-1.0 if not self.preference else self.preference.weight)
        self.weight_spin.setDecimals(1)
        layout.addRow("Weight:", self.weight_spin)
        
        # Help text
        help_label = QLabel("Negative = avoid, Positive = prefer\nHigher magnitude = stronger preference")
        help_label.setStyleSheet("color: #666; font-size: 10px;")
        layout.addRow("", help_label)
        
        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | 
            QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addRow(buttons)
        
        # Load existing preference if editing
        if self.preference:
            if self.preference.target_type == PreferenceTargetType.STUDENT:
                self.type_combo.setCurrentText("Student")
            elif self.preference.target_type == PreferenceTargetType.FURNITURE:
                self.type_combo.setCurrentText("Furniture")
        else:
            self.type_combo.setCurrentText("Student")
        
        self.on_type_changed(self.type_combo.currentText())
        
        if self.preference:
            index = self.target_combo.findData(self.preference.target_id)
            if index >= 0:
                self.target_combo.setCurrentIndex(index)
    
    def on_type_changed(self, type_text: str):
        """Update target combo based on type"""
        self.target_combo.clear()
        
        if type_text == "Student":
            for student in self.all_students:
                if student.id != self.current_student.id:
                    self.target_combo.addItem(student.name, student.id)
        
        elif type_text == "Furniture":
            self.target_combo.addItem("Front of Room", "front_area")
            self.target_combo.addItem("Back of Room", "back_area")
            self.target_combo.addItem("Door", "door")
            self.target_combo.addItem("Window", "window")
    
    def get_preference(self) -> Preference:
        """Get the preference from the dialog"""
        type_text = self.type_combo.currentText()
        target_id = self.target_combo.currentData()
        weight = self.weight_spin.value()
        
        if type_text == "Furniture":
            target_type = PreferenceTargetType.FURNITURE
        else:
            target_type = PreferenceTargetType.STUDENT
        
        return Preference(
            target_type=target_type,
            target_id=target_id,
            weight=weight
        )


class StudentInfoDialog(QDialog):
    """Read-only view of a student's name and preferences."""

    def __init__(self, student: Student, all_students: List[Student], parent=None):
        super().__init__(parent)
        self.setWindowTitle(student.name)
        self.setMinimumWidth(460)
        self._build(student, all_students)

    def _build(self, student: Student, all_students: List[Student]):
        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        # Name header
        name_label = QLabel(student.name)
        name_label.setStyleSheet(
            "font-size: 16px; font-weight: bold; padding: 4px 0 2px 0;"
        )
        layout.addWidget(name_label)

        # Preference count sub-label
        count = len(student.preferences)
        count_label = QLabel(
            f"{count} preference{'s' if count != 1 else ''}" if count else "No preferences set."
        )
        count_label.setStyleSheet("color: #666; font-style: italic; padding-bottom: 4px;")
        layout.addWidget(count_label)

        if student.preferences:
            name_map = {s.id: s.name for s in all_students}

            table = QTableWidget(count, 3)
            table.setHorizontalHeaderLabels(["Direction", "Target", "Weight"])
            table.horizontalHeader().setSectionResizeMode(
                0, QHeaderView.ResizeMode.ResizeToContents
            )
            table.horizontalHeader().setSectionResizeMode(
                1, QHeaderView.ResizeMode.Stretch
            )
            table.horizontalHeader().setSectionResizeMode(
                2, QHeaderView.ResizeMode.ResizeToContents
            )
            table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
            table.setSelectionMode(QTableWidget.SelectionMode.NoSelection)
            table.verticalHeader().setVisible(False)
            table.setAlternatingRowColors(True)
            table.setShowGrid(False)

            for i, pref in enumerate(student.preferences):
                is_avoid = pref.weight < 0
                direction = "Avoids" if is_avoid else "Prefers"
                target_name = name_map.get(pref.target_id, pref.target_id)
                weight_str = f"{pref.weight:+.1f}"

                dir_item = QTableWidgetItem(direction)
                dir_item.setForeground(
                    QColor("#C62828") if is_avoid else QColor("#2E7D32")
                )
                table.setItem(i, 0, dir_item)
                table.setItem(i, 1, QTableWidgetItem(target_name))
                table.setItem(i, 2, QTableWidgetItem(weight_str))

            layout.addWidget(table)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)