from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel,
                              QFileDialog, QMessageBox, QInputDialog,
                              QDoubleSpinBox, QSpinBox, QDialog, QPushButton,
                              QSplitter)
from PyQt6.QtCore import Qt
from typing import List, Optional
from pathlib import Path

from src.models.student import Student
from src.models.classroom import Classroom
from src.io.csv_handler import StudentExporter
from src.io.arrangement_io import ArrangementIO
from src.algorithm.seat_graph import SeatGraph, PROXIMITY_THRESHOLD
from src.ui.dialogs import AlgorithmSelectionDialog, StudentInfoDialog
from src.ui.student_list import StudentListWidget
from src.ui.seating_grid import SeatingGrid
from src.ui import theme

BASE_CELL_SIZE           = 40   # pixels per grid cell at 1× zoom
CELL_SIZE_MAX            = 80   # maximum display cell size (pixels)
CELL_SIZE_MIN            = 10   # minimum display cell size (pixels)
BASE_PROXIMITY_THRESHOLD = 1.5  # neighborhood threshold at BASE_CELL_SIZE


class StudentPlacerWidget(QWidget):
    def __init__(self):
        super().__init__()
        self.students:            List[Student]     = []
        self.current_classroom:   Optional[Classroom] = None
        self.proximity_threshold: float              = BASE_PROXIMITY_THRESHOLD
        self._init_ui()

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setStyleSheet(theme.toolbar_stylesheet() + f"""
            QPushButton#markerBtn:checked {{
                background-color: #E53935;
                color: {theme.TOOLBAR_TEXT};
            }}
            QPushButton#violationsBtn:checked {{
                background-color: {theme.TOOLBAR_BTN_CHECKED};
                color: {theme.TOOLBAR_TEXT};
            }}
        """)
        tb = QHBoxLayout(toolbar)
        tb.setContentsMargins(6, 4, 6, 4)
        tb.setSpacing(6)

        load_classroom_btn = QPushButton("Load Classroom")
        load_classroom_btn.clicked.connect(self.load_classroom)
        tb.addWidget(load_classroom_btn)

        allocate_btn = QPushButton("Allocate Students to Desks")
        allocate_btn.clicked.connect(self.allocate_students)
        tb.addWidget(allocate_btn)

        clear_btn = QPushButton("Clear Assignments")
        clear_btn.clicked.connect(self.clear_assignments)
        tb.addWidget(clear_btn)

        export_btn = QPushButton("Export Students (CSV)")
        export_btn.clicked.connect(self.export_students)
        tb.addWidget(export_btn)

        save_arr_btn = QPushButton("Save Arrangement")
        save_arr_btn.clicked.connect(self.save_arrangement)
        tb.addWidget(save_arr_btn)

        load_arr_btn = QPushButton("Load Arrangement")
        load_arr_btn.clicked.connect(self.load_arrangement)
        tb.addWidget(load_arr_btn)

        export_session_btn = QPushButton("Export Session")
        export_session_btn.clicked.connect(self.export_session)
        tb.addWidget(export_session_btn)

        import_session_btn = QPushButton("Import Session")
        import_session_btn.clicked.connect(self.import_session)
        tb.addWidget(import_session_btn)

        self.violations_btn = QPushButton("Show Violations")
        self.violations_btn.setObjectName("violationsBtn")
        self.violations_btn.setCheckable(True)
        self.violations_btn.toggled.connect(self._set_violation_mode)
        tb.addWidget(self.violations_btn)

        tb.addWidget(QLabel("Cell Size:"))
        self.cell_size_spin = QSpinBox()
        self.cell_size_spin.setRange(CELL_SIZE_MIN, CELL_SIZE_MAX)
        self.cell_size_spin.setSingleStep(5)
        self.cell_size_spin.setValue(BASE_CELL_SIZE)
        self.cell_size_spin.setFixedWidth(60)
        self.cell_size_spin.setToolTip(
            "Display size of each grid cell (pixels).\n"
            "Smaller = see more of the classroom; larger = easier to read names."
        )
        self.cell_size_spin.valueChanged.connect(self._on_cell_size_changed)
        tb.addWidget(self.cell_size_spin)

        tb.addWidget(QLabel("Nearness:"))
        self.nearness_spin = QDoubleSpinBox()
        self.nearness_spin.setRange(0.5, 10.0)
        self.nearness_spin.setSingleStep(0.5)
        self.nearness_spin.setValue(BASE_PROXIMITY_THRESHOLD)
        self.nearness_spin.setDecimals(1)
        self.nearness_spin.setFixedWidth(70)
        self.nearness_spin.setToolTip(
            "Distance (grid units) within which two desks are considered neighbors.\n"
            "1.5 = direct + diagonal. Increase to widen the neighborhood.\n"
            "Auto-scales with cell size."
        )
        self.nearness_spin.valueChanged.connect(self._on_nearness_changed)
        tb.addWidget(self.nearness_spin)

        tb.addStretch()

        tb.addWidget(QLabel("Weight:"))
        self.weight_field = QDoubleSpinBox()
        self.weight_field.setRange(-1000, 1000)
        self.weight_field.setValue(-1.0)
        self.weight_field.setDecimals(1)
        self.weight_field.setFixedWidth(80)
        tb.addWidget(self.weight_field)

        self.marker_btn = QPushButton("Red Marker Mode")
        self.marker_btn.setObjectName("markerBtn")
        self.marker_btn.setCheckable(True)
        self.marker_btn.toggled.connect(self._toggle_marker_mode)
        tb.addWidget(self.marker_btn)

        self.hint_label = QLabel("")
        tb.addWidget(self.hint_label)

        tb.addStretch()

        self.classroom_label = QLabel("No classroom loaded")
        self.classroom_label.setStyleSheet(
            f"font-weight: bold; color: {theme.TOOLBAR_TEXT};"
        )
        tb.addWidget(self.classroom_label)

        layout.addWidget(toolbar)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        self.student_list_widget = StudentListWidget()
        splitter.addWidget(self.student_list_widget)

        self.seating_grid = SeatingGrid(grid_width=20, grid_height=15,
                                        cell_size=BASE_CELL_SIZE)
        self.seating_grid.marker_mode_exited.connect(self._on_marker_mode_exited)
        self.seating_grid.student_info_requested.connect(self._show_student_info)
        splitter.addWidget(self.seating_grid)

        splitter.setSizes([200, 800])
        layout.addWidget(splitter)

    # ── toolbar event handlers ────────────────────────────────────────────────

    def _show_student_info(self, student: Student):
        dialog = StudentInfoDialog(student, self.student_list_widget.get_students(), self)
        dialog.exec()

    def _on_cell_size_changed(self, value: int):
        self.seating_grid.cell_size = value
        self.seating_grid.update_size()
        self.seating_grid.update()
        self.nearness_spin.blockSignals(True)
        scaled = BASE_PROXIMITY_THRESHOLD * (BASE_CELL_SIZE / value)
        self.nearness_spin.setValue(round(scaled, 1))
        self.nearness_spin.blockSignals(False)
        self._on_nearness_changed(scaled)

    def _on_nearness_changed(self, value: float):
        self.proximity_threshold = value
        if self.current_classroom:
            sg = SeatGraph(self.current_classroom, proximity_threshold=value)
            self.seating_grid.set_seat_graph(sg)

    def _set_violation_mode(self, checked: bool):
        if checked:
            if not self.current_classroom:
                self.violations_btn.setChecked(False)
                QMessageBox.information(
                    self, "No Classroom",
                    "Load a classroom before using violation highlighting."
                )
                return
            self.seating_grid.set_seat_graph(
                SeatGraph(self.current_classroom,
                          proximity_threshold=self.proximity_threshold)
            )
        self.seating_grid.set_violation_mode(checked)

    def _on_marker_mode_exited(self):
        self.marker_btn.setChecked(False)
        self.hint_label.setText("")
        self.weight_field.setEnabled(True)

    def _toggle_marker_mode(self, checked: bool):
        weight = self.weight_field.value()
        self.seating_grid.set_marker_mode(checked, weight)
        if checked:
            self.hint_label.setText(
                "Click a student, then click another to create preference. ESC to exit."
            )
            self.weight_field.setEnabled(False)
        else:
            self.hint_label.setText("")
            self.weight_field.setEnabled(True)

    # ── classroom I/O ────────────────────────────────────────────────────────

    def load_classroom(self):
        saved = Classroom.list_saved_classrooms()
        if not saved:
            QMessageBox.information(
                self, "No Classrooms",
                "No saved classrooms found. Please create one in the Classroom Builder."
            )
            return

        name, ok = QInputDialog.getItem(
            self, "Load Classroom", "Select classroom:", saved, 0, False
        )
        if not ok or not name:
            return

        try:
            classroom = Classroom.load_from_file(
                Path("data/classrooms") / f"{name}.json"
            )
            seats = sum(f.seat_count() for f in classroom.furniture)
            self.current_classroom = classroom
            self.seating_grid.set_classroom(classroom)

            sg = SeatGraph(classroom, proximity_threshold=self.proximity_threshold)
            self.seating_grid.apply_fixtures(sg.fixtures)
            self.seating_grid.set_seat_graph(sg)

            self.classroom_label.setText(f"Classroom: {name}\nSeats: {seats}")
            QMessageBox.information(
                self, "Success",
                f"Loaded classroom: {name}\n{seats} seats available"
            )
        except Exception as e:
            QMessageBox.critical(self, "Error",
                                 f"Failed to load classroom:\n{e}")

    # ── student allocation ────────────────────────────────────────────────────

    def allocate_students(self):
        if not self.current_classroom:
            QMessageBox.warning(self, "No Classroom", "Please load a classroom first.")
            return

        all_students = self.student_list_widget.get_students()
        students = [s for s in all_students if not s.metadata.get("is_fixture")]
        if not students:
            QMessageBox.warning(self, "No Students", "Please import students first.")
            return

        dialog = AlgorithmSelectionDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        sg = SeatGraph(self.current_classroom,
                       proximity_threshold=self.proximity_threshold)
        if not sg.assignable:
            QMessageBox.warning(
                self, "No Seats",
                "This classroom has no assignable seats.\n"
                "Add student desks in the Classroom Builder first."
            )
            return

        for fid, student in self.seating_grid.assignments.items():
            if fid in self.seating_grid.locked_seats:
                sg.assign(fid, student)
                sg.lock(fid)

        allocator = dialog.get_allocator()
        assignments = allocator.allocate(students, self.current_classroom, sg)
        self.seating_grid.apply_assignments(assignments)
        self.seating_grid.set_seat_graph(sg)

        placed = len([f for f in assignments
                      if f not in self.seating_grid.fixture_seats])
        seats_available = len(sg.assignable)
        if placed < len(students):
            unplaced = len(students) - placed
            QMessageBox.warning(
                self, "Not All Placed",
                f"{placed} of {len(students)} students assigned.\n"
                f"{unplaced} student(s) couldn't be placed — "
                f"only {seats_available} seat(s) available."
            )
        else:
            QMessageBox.information(self, "Done",
                                    f"All {placed} students assigned to seats.")

    def clear_assignments(self):
        assignments = self.seating_grid.get_assignments()
        has_students = any(fid not in self.seating_grid.fixture_seats
                           for fid in assignments)
        if has_students:
            reply = QMessageBox.question(
                self, "Clear Assignments",
                "Remove all student assignments from the current layout?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return
        self.seating_grid.clear_assignments()

    # ── student CSV I/O ───────────────────────────────────────────────────────

    def export_students(self):
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
                    fixture_students.append(
                        Student(id=fx.id, name=fx.name, metadata={"is_fixture": True})
                    )

        try:
            StudentExporter().export_to_csv(
                students + fixture_students, filepath, id_to_name
            )
            QMessageBox.information(self, "Exported",
                                    f"Students exported to {filepath}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to export:\n{e}")

    # ── arrangement I/O ───────────────────────────────────────────────────────

    def save_arrangement(self):
        if not self.current_classroom:
            QMessageBox.warning(self, "No Classroom", "Please load a classroom first.")
            return
        assignments = self.seating_grid.get_assignments()
        if not any(fid not in self.seating_grid.fixture_seats for fid in assignments):
            QMessageBox.warning(self, "No Assignments",
                                "No students have been assigned yet.")
            return

        filepath = Path("data/arrangements") / f"{self.current_classroom.name}.json"
        if filepath.exists():
            reply = QMessageBox.question(
                self, "Overwrite?",
                f"An arrangement for \"{self.current_classroom.name}\" already exists.\n"
                "Overwrite it?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        try:
            saved = ArrangementIO.save(
                self.current_classroom.name, assignments,
                self.seating_grid.fixture_seats,
            )
            QMessageBox.information(self, "Saved", f"Arrangement saved to {saved}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save arrangement:\n{e}")

    def load_arrangement(self):
        students = [s for s in self.student_list_widget.get_students()
                    if not s.metadata.get("is_fixture")]
        if not students:
            QMessageBox.warning(self, "No Students", "Please import students first.")
            return

        saved = ArrangementIO.list_saved()
        if not saved:
            QMessageBox.information(self, "No Arrangements",
                                    "No saved arrangements found.")
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
                sg = SeatGraph(self.current_classroom,
                               proximity_threshold=self.proximity_threshold)
                self.seating_grid.set_seat_graph(sg)

            matched = len(assignments)
            skipped = len(students) - matched
            msg = (f"Loaded arrangement: {name}\n"
                   f"{matched} of {len(students)} students matched.")
            if skipped > 0:
                msg += f"\n{skipped} student(s) not found in the saved arrangement."
            QMessageBox.information(self, "Loaded", msg)
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to load arrangement:\n{e}")

    # ── session I/O ───────────────────────────────────────────────────────────

    def export_session(self):
        from src.io.session_io import SessionIO

        classrooms = []
        for name in Classroom.list_saved_classrooms():
            try:
                classrooms.append(
                    Classroom.load_from_file(Path("data/classrooms") / f"{name}.json")
                )
            except Exception:
                pass

        if not classrooms:
            QMessageBox.warning(
                self, "Nothing to Export",
                "No saved classrooms found. Save at least one classroom first."
            )
            return

        students = self.student_list_widget.get_students()
        filepath, _ = QFileDialog.getSaveFileName(
            self, "Export Session", "session.pijon",
            "Pijon Session (*.pijon);;All Files (*)"
        )
        if not filepath:
            return

        try:
            SessionIO.save(filepath, classrooms, students)
            QMessageBox.information(self, "Exported",
                                    f"Session exported to:\n{filepath}")
        except Exception as e:
            QMessageBox.critical(self, "Export Failed",
                                 f"Could not export session:\n{e}")

    def import_session(self):
        from src.io.session_io import SessionIO

        filepath, _ = QFileDialog.getOpenFileName(
            self, "Import Session", "",
            "Pijon Session (*.pijon);;All Files (*)"
        )
        if not filepath:
            return

        try:
            bundle = SessionIO.load(filepath)
        except Exception as e:
            QMessageBox.critical(self, "Import Failed",
                                 f"Could not read session file:\n{e}")
            return

        saved_names = []
        for classroom in bundle.classrooms:
            try:
                classroom.save_to_file()
                saved_names.append(classroom.name)
            except Exception as e:
                QMessageBox.warning(
                    self, "Classroom Save Failed",
                    f"Could not save classroom \"{classroom.name}\":\n{e}"
                )

        self.set_students(bundle.students)

        msg = (f"Session imported.\n"
               f"Classrooms saved: {len(saved_names)}\n"
               f"Students loaded: {len(bundle.students)}")
        if bundle.arrangements:
            msg += (f"\nArrangements bundled: {len(bundle.arrangements)}"
                    " (load via \"Load Arrangement\")")
        QMessageBox.information(self, "Import Complete", msg)

    # ── public API ────────────────────────────────────────────────────────────

    def set_students(self, students: List[Student]):
        self.students = students
        self.student_list_widget.set_students(students)
