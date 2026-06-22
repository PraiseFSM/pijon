import pytest
from src.algorithm.seat_graph import SeatGraph, PROXIMITY_THRESHOLD
from src.utils import fixture_id as _fixture_id
from tests.conftest import make_classroom, desk, teacher_desk


class TestProximity:
    def test_adjacent_desks_are_neighbors(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        g = SeatGraph(c)
        assert g.are_neighbors("a", "b")
        assert g.are_neighbors("b", "a")

    def test_diagonal_desks_are_neighbors(self):
        # distance = sqrt(2) ≈ 1.414 < 1.5
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 1))
        g = SeatGraph(c)
        assert g.are_neighbors("a", "b")

    def test_far_desks_are_not_neighbors(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 5, 0))
        g = SeatGraph(c)
        assert not g.are_neighbors("a", "b")

    def test_gap_of_two_not_neighbor(self):
        # centers at (0.5, 0.5) and (2.5, 0.5) → distance = 2.0 > 1.5
        c = make_classroom(desk("a", 0, 0), desk("b", 2, 0))
        g = SeatGraph(c)
        assert not g.are_neighbors("a", "b")

    def test_edges_are_symmetric(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0), desk("c", 2, 0))
        g = SeatGraph(c)
        for fid in ("a", "b", "c"):
            for nbr in g.neighbors(fid):
                assert fid in g.neighbors(nbr)

    def test_custom_threshold(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 2, 0))
        # Default threshold: not neighbors. With threshold=3 they become neighbors.
        g_default = SeatGraph(c)
        g_wide = SeatGraph(c, proximity_threshold=3.0)
        assert not g_default.are_neighbors("a", "b")
        assert g_wide.are_neighbors("a", "b")

    def test_set_proximity_threshold_rebuilds(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 2, 0))
        g = SeatGraph(c)
        assert not g.are_neighbors("a", "b")
        g.set_proximity_threshold(3.0, c)
        assert g.are_neighbors("a", "b")


class TestAssignable:
    def test_single_desk_is_assignable(self):
        c = make_classroom(desk("d", 0, 0))
        g = SeatGraph(c)
        assert "d" in g.assignable

    def test_teacher_desk_not_assignable(self):
        c = make_classroom(teacher_desk("td", 0, 0))
        g = SeatGraph(c)
        assert "td" not in g.assignable

    def test_available_excludes_occupied(self):
        from tests.conftest import student
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        g = SeatGraph(c)
        g.assign("a", student("s1", "Alice"))
        assert "a" not in g.available_seat_ids()
        assert "b" in g.available_seat_ids()

    def test_available_excludes_locked(self):
        c = make_classroom(desk("a", 0, 0), desk("b", 1, 0))
        g = SeatGraph(c)
        g.lock("a")
        assert "a" not in g.available_seat_ids()

    def test_unlock_restores_availability(self):
        c = make_classroom(desk("a", 0, 0))
        g = SeatGraph(c)
        g.lock("a")
        g.unlock("a")
        assert "a" in g.available_seat_ids()


class TestFixtures:
    def test_teacher_desk_creates_fixture_sentinel(self):
        c = make_classroom(teacher_desk("td", 0, 0))
        g = SeatGraph(c)
        assert "td" in g.fixtures
        sentinel = g.fixtures["td"]
        assert sentinel.metadata.get("is_fixture")

    def test_fixture_sentinel_id_matches_utils_fixture_id(self):
        """SeatGraph uses utils.fixture_id — sentinel ID must match the canonical function."""
        c = make_classroom(teacher_desk("td", 0, 0))
        g = SeatGraph(c)
        sentinel = g.fixtures["td"]
        name = "Teacher Desk"
        assert sentinel.id == _fixture_id(name)

    def test_fixture_id_to_fid_reverse_map(self):
        c = make_classroom(teacher_desk("td", 0, 0))
        g = SeatGraph(c)
        sentinel = g.fixtures["td"]
        assert g.fixture_id_to_fid[sentinel.id] == "td"

    def test_fixture_neighbors_nearby_desk(self):
        c = make_classroom(teacher_desk("td", 0, 0), desk("d", 1, 0))
        g = SeatGraph(c)
        assert g.are_neighbors("td", "d")

    def test_fixture_not_in_assignable(self):
        c = make_classroom(teacher_desk("td", 0, 0))
        g = SeatGraph(c)
        assert "td" not in g.assignable
