"""Tests for .pijon session bundle export/import."""
import pytest
from pathlib import Path
from src.io.session_io import SessionIO, SessionBundle
from src.models.classroom import Classroom
from src.models.student import Student
from src.models.preference import Preference, PreferenceTargetType
from tests.conftest import desk, teacher_desk, make_classroom


def _make_students():
    alice = Student(id="a1", name="Alice")
    bob   = Student(id="b1", name="Bob")
    alice.add_preference(Preference(PreferenceTargetType.STUDENT, "b1", -1.0))
    bob.add_preference(Preference(PreferenceTargetType.STUDENT, "a1", -1.0))
    return [alice, bob]


def _make_classrooms():
    c = make_classroom(desk("d1", 0, 0), desk("d2", 1, 0))
    c.name = "TestRoom"
    c.grid_width = 20
    c.grid_height = 15
    return [c]


class TestSessionIORoundTrip:
    def test_classrooms_preserved(self, tmp_path):
        classrooms = _make_classrooms()
        students   = _make_students()
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, classrooms, students)
        bundle = SessionIO.load(p)
        assert len(bundle.classrooms) == 1
        assert bundle.classrooms[0].name == "TestRoom"

    def test_furniture_preserved(self, tmp_path):
        classrooms = _make_classrooms()
        students   = _make_students()
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, classrooms, students)
        bundle = SessionIO.load(p)
        fids = {f.furniture_id for f in bundle.classrooms[0].furniture}
        assert "d1" in fids
        assert "d2" in fids

    def test_student_names_preserved(self, tmp_path):
        classrooms = _make_classrooms()
        students   = _make_students()
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, classrooms, students)
        bundle = SessionIO.load(p)
        names = {s.name for s in bundle.students}
        assert "Alice" in names
        assert "Bob" in names

    def test_student_count(self, tmp_path):
        classrooms = _make_classrooms()
        students   = _make_students()
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, classrooms, students)
        bundle = SessionIO.load(p)
        assert len(bundle.students) == 2

    def test_preferences_preserved(self, tmp_path):
        classrooms = _make_classrooms()
        students   = _make_students()
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, classrooms, students)
        bundle = SessionIO.load(p)
        alice2 = next(s for s in bundle.students if s.name == "Alice")
        bob2   = next(s for s in bundle.students if s.name == "Bob")
        assert len(alice2.preferences) >= 1
        assert alice2.preferences[0].target_id == bob2.id
        assert alice2.preferences[0].weight == -1.0

    def test_produces_zip_file(self, tmp_path):
        import zipfile
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, _make_classrooms(), _make_students())
        assert zipfile.is_zipfile(p)

    def test_zip_contains_expected_entries(self, tmp_path):
        import zipfile
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, _make_classrooms(), _make_students())
        with zipfile.ZipFile(p) as zf:
            names = set(zf.namelist())
        assert "classrooms/TestRoom.json" in names
        assert "students.csv" in names

    def test_empty_students_list(self, tmp_path):
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, _make_classrooms(), [])
        bundle = SessionIO.load(p)
        assert bundle.students == []

    def test_multiple_classrooms(self, tmp_path):
        c1 = make_classroom(desk("d1", 0, 0))
        c1.name = "Room1"
        c2 = make_classroom(desk("d2", 0, 0))
        c2.name = "Room2"
        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, [c1, c2], [])
        bundle = SessionIO.load(p)
        names = {c.name for c in bundle.classrooms}
        assert names == {"Room1", "Room2"}

    def test_arrangement_bundled_when_present(self, tmp_path):
        import json, zipfile
        # Create a fake arrangement file on disk
        arr_dir = tmp_path / "arrangements"
        arr_dir.mkdir()
        arr_file = arr_dir / "TestRoom.json"
        arr_file.write_text(json.dumps({
            "classroom": "TestRoom",
            "assignments": {"d1": "Alice"},
        }))

        p = str(tmp_path / "session.pijon")
        SessionIO.save(p, _make_classrooms(), _make_students(),
                       arrangement_dir=arr_dir)

        with zipfile.ZipFile(p) as zf:
            assert "arrangements/TestRoom.json" in zf.namelist()

        bundle = SessionIO.load(p)
        assert "TestRoom" in bundle.arrangements
        assert bundle.arrangements["TestRoom"]["d1"] == "Alice"
