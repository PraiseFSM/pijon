import json
import pytest
from pathlib import Path
from src.io.arrangement_io import ArrangementIO
from src.models.student import Student


def make_students(*names):
    return [Student(id=f"id_{n}", name=n) for n in names]


class TestArrangementSave:
    def test_creates_file(self, tmp_path):
        students = make_students("Alice", "Bob")
        assignments = {"desk_0": students[0], "desk_1": students[1]}
        path = ArrangementIO.save("Room1", assignments, set(), directory=tmp_path)
        assert path.exists()

    def test_fixture_seats_excluded(self, tmp_path):
        students = make_students("Alice")
        fixture = Student(id="fix_id", name="Teacher Desk", metadata={"is_fixture": True})
        assignments = {"desk_0": students[0], "td_0": fixture}
        ArrangementIO.save("Room1", assignments, {"td_0"}, directory=tmp_path)

        data = json.loads((tmp_path / "Room1.json").read_text())
        assert "td_0" not in data["assignments"]
        assert "desk_0" in data["assignments"]

    def test_file_content_uses_names(self, tmp_path):
        students = make_students("Alice")
        assignments = {"desk_0": students[0]}
        ArrangementIO.save("Room1", assignments, set(), directory=tmp_path)
        data = json.loads((tmp_path / "Room1.json").read_text())
        assert data["assignments"]["desk_0"] == "Alice"
        assert data["classroom"] == "Room1"

    def test_creates_directory_if_missing(self, tmp_path):
        subdir = tmp_path / "nested" / "arrangements"
        students = make_students("Alice")
        ArrangementIO.save("Room1", {"d": students[0]}, set(), directory=subdir)
        assert subdir.exists()


class TestArrangementLoad:
    def _save_and_load(self, tmp_path, assignments, fixture_seats, students):
        ArrangementIO.save("Room1", assignments, fixture_seats, directory=tmp_path)
        path = tmp_path / "Room1.json"
        return ArrangementIO.load(path, students)

    def test_round_trip(self, tmp_path):
        students = make_students("Alice", "Bob")
        assignments = {"desk_0": students[0], "desk_1": students[1]}
        loaded, name = self._save_and_load(tmp_path, assignments, set(), students)
        assert loaded["desk_0"].name == "Alice"
        assert loaded["desk_1"].name == "Bob"
        assert name == "Room1"

    def test_unmatched_name_skipped(self, tmp_path):
        # Save with Alice; load with Bob in the student list (Alice gone)
        students_save = make_students("Alice")
        assignments = {"desk_0": students_save[0]}
        ArrangementIO.save("Room1", assignments, set(), directory=tmp_path)
        students_load = make_students("Bob")
        loaded, _ = ArrangementIO.load(tmp_path / "Room1.json", students_load)
        assert "desk_0" not in loaded

    def test_extra_students_not_in_arrangement(self, tmp_path):
        students = make_students("Alice", "Bob")
        # Only Alice in the arrangement
        ArrangementIO.save("Room1", {"desk_0": students[0]}, set(), directory=tmp_path)
        loaded, _ = ArrangementIO.load(tmp_path / "Room1.json", students)
        assert "desk_0" in loaded
        assert len(loaded) == 1

    def test_empty_arrangement(self, tmp_path):
        students = make_students("Alice")
        ArrangementIO.save("Room1", {}, set(), directory=tmp_path)
        loaded, _ = ArrangementIO.load(tmp_path / "Room1.json", students)
        assert loaded == {}


class TestListSaved:
    def test_lists_saved_files(self, tmp_path):
        students = make_students("Alice")
        ArrangementIO.save("RoomA", {"d": students[0]}, set(), directory=tmp_path)
        ArrangementIO.save("RoomB", {"d": students[0]}, set(), directory=tmp_path)
        names = ArrangementIO.list_saved(tmp_path)
        assert set(names) == {"RoomA", "RoomB"}

    def test_empty_directory(self, tmp_path):
        assert ArrangementIO.list_saved(tmp_path) == []

    def test_missing_directory(self, tmp_path):
        assert ArrangementIO.list_saved(tmp_path / "nonexistent") == []
