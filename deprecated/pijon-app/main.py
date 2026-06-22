import sys
from PyQt6.QtWidgets import QApplication, QMainWindow, QTabWidget
from PyQt6.QtCore import Qt

from src.ui.classroom_builder import ClassroomBuilderWidget
from src.ui.student_placer import StudentPlacerWidget
from src.ui import theme


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Pijon")
        self.setGeometry(100, 100, 1200, 800)

        self.tabs = QTabWidget()
        self.tabs.setStyleSheet(f"""
            QTabWidget::pane {{
                border: none;
                background-color: {theme.GRID_BG};
            }}
            QTabBar::tab {{
                background-color: {theme.TAB_BAR_BG};
                color: {theme.TAB_TEXT};
                padding: 8px 20px;
                border: none;
                margin-right: 2px;
            }}
            QTabBar::tab:selected {{
                background-color: {theme.TAB_SELECTED_BG};
                border-bottom: 2px solid {theme.TOOLBAR_BTN_CHECKED};
            }}
            QTabBar::tab:hover {{
                background-color: {theme.TOOLBAR_BTN_HOVER};
            }}
        """)
        self.setCentralWidget(self.tabs)

        self.classroom_builder = ClassroomBuilderWidget()
        self.student_placer = StudentPlacerWidget()

        self.tabs.addTab(self.classroom_builder, "Build Classroom")
        self.tabs.addTab(self.student_placer, "Place Students")


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()