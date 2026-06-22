"""
Tests for bidirectional preference storage and enforcement.

Design contract: every STUDENT-type preference Alice→Bob must always be
mirrored as Bob→Alice with the same weight.  This invariant is established:
  - After CSV import  (enforce_bidirectional)
  - After preference add/edit/remove via utils helpers
  - After allocation (the allocator no longer applies a runtime reverse loop)
"""
import pytest
from src.models.student import Student
from src.models.preference import Preference, PreferenceTargetType
from src.utils import (
    mirror_student_preference,
    remove_mirror_preference,
    enforce_bidirectional,
)
from tests.conftest import student, avoid, prefer, desk, make_classroom


# ── mirror_student_preference ─────────────────────────────────────────────────

class TestMirrorStudentPreference:
    def test_creates_mirror_when_absent(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        mirror_student_preference(alice, bob, weight=-1.0)
        pref = bob.get_preference_for("a")
        assert pref is not None
        assert pref.weight == -1.0
        assert pref.target_type == PreferenceTargetType.STUDENT

    def test_updates_weight_when_mirror_exists(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        bob.add_preference(Preference(PreferenceTargetType.STUDENT, "a", -1.0))
        mirror_student_preference(alice, bob, weight=-2.0)
        assert bob.get_preference_for("a").weight == -2.0

    def test_does_not_duplicate_mirror(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        mirror_student_preference(alice, bob, weight=-1.0)
        mirror_student_preference(alice, bob, weight=-1.0)
        assert len([p for p in bob.preferences if p.target_id == "a"]) == 1

    def test_positive_weight_mirrored(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        mirror_student_preference(alice, bob, weight=2.0)
        assert bob.get_preference_for("a").weight == 2.0

    def test_does_not_touch_source(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        mirror_student_preference(alice, bob, weight=-1.0)
        # alice should still have no preferences
        assert alice.preferences == []


# ── remove_mirror_preference ─────────────────────────────────────────────────

class TestRemoveMirrorPreference:
    def test_removes_existing_mirror(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        bob.add_preference(Preference(PreferenceTargetType.STUDENT, "a", -1.0))
        remove_mirror_preference(alice, "b", [alice, bob])
        assert bob.get_preference_for("a") is None

    def test_no_op_when_target_missing(self):
        alice = Student(id="a", name="Alice")
        # target_id "z" not in students list — should not raise
        remove_mirror_preference(alice, "z", [alice])

    def test_no_op_when_mirror_already_absent(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        # bob has no preference for alice — should not raise
        remove_mirror_preference(alice, "b", [alice, bob])
        assert bob.preferences == []

    def test_only_removes_source_target_pair(self):
        alice = Student(id="a", name="Alice")
        bob   = Student(id="b", name="Bob")
        carol = Student(id="c", name="Carol")
        bob.add_preference(Preference(PreferenceTargetType.STUDENT, "a", -1.0))
        bob.add_preference(Preference(PreferenceTargetType.STUDENT, "c", -1.0))
        remove_mirror_preference(alice, "b", [alice, bob, carol])
        assert bob.get_preference_for("a") is None
        assert bob.get_preference_for("c") is not None


# ── enforce_bidirectional ─────────────────────────────────────────────────────

class TestEnforceBidirectional:
    def test_adds_missing_mirror(self):
        alice = student("a", "Alice", avoid("b"))
        bob   = student("b", "Bob")
        enforce_bidirectional([alice, bob])
        assert bob.get_preference_for("a") is not None
        assert bob.get_preference_for("a").weight == -1.0

    def test_does_not_overwrite_existing(self):
        alice = student("a", "Alice", avoid("b", -1.0))
        bob   = student("b", "Bob", prefer("a", 2.0))
        enforce_bidirectional([alice, bob])
        # bob explicitly prefers alice — do NOT clobber with alice's avoid weight
        assert bob.get_preference_for("a").weight == 2.0

    def test_idempotent(self):
        alice = student("a", "Alice", avoid("b"))
        bob   = student("b", "Bob")
        enforce_bidirectional([alice, bob])
        enforce_bidirectional([alice, bob])
        mirrors = [p for p in bob.preferences if p.target_id == "a"]
        assert len(mirrors) == 1

    def test_furniture_preferences_unchanged(self):
        from src.utils import fixture_id
        fid = fixture_id("Teacher Desk")
        alice = Student(id="a", name="Alice")
        alice.add_preference(Preference(PreferenceTargetType.FURNITURE, fid, -1.0))
        enforce_bidirectional([alice])
        # nothing should have been added or broken
        assert len(alice.preferences) == 1

    def test_unknown_target_skipped(self):
        alice = student("a", "Alice", avoid("nonexistent_id"))
        enforce_bidirectional([alice])
        # no crash, alice's own preference unchanged
        assert len(alice.preferences) == 1


# ── Allocator: no double-counting with bidirectional storage ─────────────────

class TestAllocatorBidirectional:
    """
    If preferences are stored at both ends, the allocator must NOT apply a
    reverse lookup or costs will be doubled.
    """

    def _run(self, classroom, students):
        from src.algorithm.seat_graph import SeatGraph
        from src.algorithm.allocator import GreedyAllocator
        graph = SeatGraph(classroom)
        return GreedyAllocator().allocate(students, classroom, graph)

    def test_symmetric_avoid_does_not_double_penalty(self):
        """
        Alice avoid Bob stored both ways. After allocation they should be
        placed apart — but the cost function should not apply the penalty twice.
        We verify behaviour (apart) not the exact cost value, since cost is
        internal.
        """
        c = make_classroom(desk("d1", 0, 0), desk("d2", 1, 0), desk("d3", 5, 0))
        alice = student("a", "Alice", avoid("b", -2.0))
        bob   = student("b", "Bob",   avoid("a", -2.0))
        carol = student("c", "Carol")
        enforce_bidirectional([alice, bob, carol])

        assignments = self._run(c, [alice, bob, carol])
        alice_seat = next(fid for fid, s in assignments.items() if s.id == "a")
        bob_seat   = next(fid for fid, s in assignments.items() if s.id == "b")
        from src.algorithm.seat_graph import SeatGraph
        g = SeatGraph(c)
        assert not g.are_neighbors(alice_seat, bob_seat), \
            "Alice and Bob should not be placed as neighbors when they mutually avoid each other"

    def test_prefer_placed_near(self):
        c = make_classroom(desk("d1", 0, 0), desk("d2", 1, 0), desk("d3", 5, 0))
        alice = student("a", "Alice", prefer("b", 2.0))
        bob   = student("b", "Bob",   prefer("a", 2.0))
        carol = student("c", "Carol")

        assignments = self._run(c, [alice, bob, carol])
        alice_seat = next(fid for fid, s in assignments.items() if s.id == "a")
        bob_seat   = next(fid for fid, s in assignments.items() if s.id == "b")
        from src.algorithm.seat_graph import SeatGraph
        g = SeatGraph(c)
        assert g.are_neighbors(alice_seat, bob_seat), \
            "Alice and Bob should be placed as neighbors when they mutually prefer each other"
