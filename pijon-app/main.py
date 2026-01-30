import sys
from PyQt6.QtWidgets import QApplication, QMainWindow, QTabWidget
from PyQt6.QtCore import Qt

from src.ui.setup_widget import SetupWidget
from src.ui.classroom_builder import ClassroomBuilderWidget
from src.ui.student_placer import StudentPlacerWidget


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Pijon")
        self.setGeometry(100, 100, 1200, 800)
        
        # Create tab widget
        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)
        
        # Create the different tabs
        self.setup_widget = SetupWidget()
        self.classroom_builder = ClassroomBuilderWidget()
        self.student_placer = StudentPlacerWidget()
        
        # Connect signals - when students are imported, pass them to student placer
        self.setup_widget.students_imported.connect(self.student_placer.set_students)
        
        # Add tabs
        self.tabs.addTab(self.setup_widget, "📋 Setup")
        self.tabs.addTab(self.classroom_builder, "🏫 Build Classroom")
        self.tabs.addTab(self.student_placer, "👥 Place Students")


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()