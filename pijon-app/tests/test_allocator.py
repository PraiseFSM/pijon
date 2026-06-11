import pytest
from src.algorithm.allocator import BogoAllocator, GreedyAllocator
from src.algorithm.seat_graph import SeatGraph
from src.models.preference import PreferenceTargetType, Preference
from tests.conftest import make_classroom, desk, teacher_desk, student, avoid, prefer


# ── BogoAllocator ─────────────────────────────────────────────────────────────

class TestBogoAllocator:
    def test_all_students_placed_when_enough_seats(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0), desk("c", 2, 0))
        students = [student("s1", "Alice"), student("s2", "Bob"), student("s3", "Carol")]
        result = BogoAllocator().allocate(students, c, SeatGraph(c))
        assigned = [s for s in result.values() if not s.metadata.get("is_fixture")]
        assert len(assigned) == 3

    def test_partial_fill_when_more_students_than_seats(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        students = [student(f"s{i}", f"S{i}") for i in range(5)]
        result = BogoAllocator().allocate(students, c, SeatGraph(c))
        real = [s for s in result.values() if not s.metadata.get("is_fixture")]
        assert len(real) == 2

    def test_empty_student_list(self):
        c = make_classroom(desk("a", 0, 0))
        result = BogoAllocator().allocate([], c, SeatGraph(c))
        assert result == {}

    def test_empty_classroom(self):
        c = make_classroom()
        students = [student("s1", "Alice")]
        result = BogoAllocator().allocate(students, c, SeatGraph(c))
        assert result == {}

    def test_locked_seat_preserved(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        alice = student("s1", "Alice")
        g = SeatGraph(c)
        g.assign("a", alice)
        g.lock("a")
        bob = student("s2", "Bob")
        result = BogoAllocator().allocate([alice, bob], c, g)
        assert result["a"].id == "s1"

    def test_randomness_produces_different_orderings(self):
        # With enough repeats, at least two different arrangements should appear
        c = make_classroom(*[desk(f"d{i}", i, 0) for i in range(5)])
        students = [student(f"s{i}", f"S{i}") for i in range(5)]
        seen = set()
        for _ in range(20):
            result = BogoAllocator().allocate(students, c, SeatGraph(c))
            key = tuple(sorted((fid, s.id) for fid, s in result.items()))
            seen.add(key)
        assert len(seen) > 1, "BogoAllocator should produce different orderings"


# ── GreedyAllocator ───────────────────────────────────────────────────────────

class TestGreedyAllocator:
    def test_all_students_placed_when_enough_seats(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        students = [student("s1", "Alice"), student("s2", "Bob")]
        result = GreedyAllocator().allocate(students, c, SeatGraph(c))
        real = [s for s in result.values() if not s.metadata.get("is_fixture")]
        assert len(real) == 2

    def test_partial_fill_when_more_students_than_seats(self):
        c = make_classroom(desk("a", 0, 0))
        students = [student("s1", "Alice"), student("s2", "Bob")]
        result = GreedyAllocator().allocate(students, c, SeatGraph(c))
        real = [s for s in result.values() if not s.metadata.get("is_fixture")]
        assert len(real) == 1

    def test_empty_student_list(self):
        c = make_classroom(desk("a", 0, 0))
        result = GreedyAllocator().allocate([], c, SeatGraph(c))
        assert result == {}

    def test_empty_classroom(self):
        c = make_classroom()
        students = [student("s1", "Alice")]
        result = GreedyAllocator().allocate(students, c, SeatGraph(c))
        assert result == {}

    def test_avoid_pair_not_placed_adjacent(self):
        # With 4 desks and only 2 students who avoid each other,
        # greedy should separate them.
        c = make_classroom(
            desk("a", 0, 0), desk("b", 1, 0),   # adjacent
            desk("c", 5, 0), desk("d", 6, 0),   # adjacent, but far from a/b
        )
        alice = student("s1", "Alice", avoid("s2", -10.0))
        bob = student("s2", "Bob", avoid("s1", -10.0))
        g = SeatGraph(c)
        result = GreedyAllocator().allocate([alice, bob], c, g)
        alice_seat = next(fid for fid, s in result.items() if s.id == "s1")
        bob_seat = next(fid for fid, s in result.items() if s.id == "s2")
        assert not g.are_neighbors(alice_seat, bob_seat)

    def test_prefer_pair_placed_adjacent(self):
        # Bob prefers Alice. Alice is pre-locked so the algorithm sees her
        # when scoring Bob's seat. Bob should choose the seat next to Alice.
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0), desk("c", 5, 0))
        alice = student("s1", "Alice")
        bob = student("s2", "Bob", prefer("s1", 10.0))
        g = SeatGraph(c)
        g.assign("a", alice)
        g.lock("a")
        result = GreedyAllocator().allocate([alice, bob], c, g)
        assert result.get("b") is not None and result["b"].id == "s2"

    def test_locked_seat_preserved(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        alice = student("s1", "Alice")
        g = SeatGraph(c)
        g.assign("a", alice)
        g.lock("a")
        bob = student("s2", "Bob")
        result = GreedyAllocator().allocate([alice, bob], c, g)
        assert result.get("a") and result["a"].id == "s1"
        assert result.get("b") and result["b"].id == "s2"

    def test_most_constrained_placed_first(self):
        # Alice has high-weight preference, Bob has none.
        # Both valid seats: one next to fixture, one not.
        # Alice should get to pick first.
        c = make_classroom(
            desk("a", 0, 0), desk("b", 5, 0),
            teacher_desk("td", 1, 0),  # adjacent to "a"
        )
        td_fixture_id = SeatGraph(c).fixtures["td"].id
        alice = student("s1", "Alice",
                        Preference(PreferenceTargetType.FURNITURE, td_fixture_id, 10.0))
        bob = student("s2", "Bob")
        g = SeatGraph(c)
        result = GreedyAllocator().allocate([alice, bob], c, g)
        alice_seat = next(fid for fid, s in result.items() if s.id == "s1")
        assert g.are_neighbors(alice_seat, "td")


# ── Marginal cost ─────────────────────────────────────────────────────────────

class TestMarginalCost:
    def _setup(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0), desk("c", 5, 0))
        g = SeatGraph(c)
        return c, g

    def test_avoid_neighbor_positive_cost(self):
        c, g = self._setup()
        alice = student("s1", "Alice", avoid("s2", -2.0))
        bob = student("s2", "Bob")
        g.assign("b", bob)
        allocator = GreedyAllocator()
        cost_next = allocator._marginal_cost(alice, "a", {"b": bob}, {"s2": "b"}, g)
        cost_far = allocator._marginal_cost(alice, "c", {"b": bob}, {"s2": "b"}, g)
        assert cost_next > cost_far

    def test_prefer_neighbor_negative_cost(self):
        c, g = self._setup()
        alice = student("s1", "Alice", prefer("s2", 2.0))
        bob = student("s2", "Bob")
        g.assign("b", bob)
        allocator = GreedyAllocator()
        cost_next = allocator._marginal_cost(alice, "a", {"b": bob}, {"s2": "b"}, g)
        cost_far = allocator._marginal_cost(alice, "c", {"b": bob}, {"s2": "b"}, g)
        assert cost_next < cost_far

    def test_bidirectional_cost(self):
        # Bob avoids Alice, but Alice has no preferences.
        # Placing Alice next to Bob should still incur a cost.
        c, g = self._setup()
        alice = student("s1", "Alice")
        bob = student("s2", "Bob", avoid("s1", -5.0))
        g.assign("b", bob)
        allocator = GreedyAllocator()
        cost_next = allocator._marginal_cost(alice, "a", {"b": bob}, {"s2": "b"}, g)
        cost_far = allocator._marginal_cost(alice, "c", {"b": bob}, {"s2": "b"}, g)
        assert cost_next > cost_far

    def test_no_preferences_zero_cost(self):
        c, g = self._setup()
        alice = student("s1", "Alice")
        allocator = GreedyAllocator()
        cost = allocator._marginal_cost(alice, "a", {}, {}, g)
        assert cost == 0.0
