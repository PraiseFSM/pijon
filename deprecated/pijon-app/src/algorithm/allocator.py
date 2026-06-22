import random
from abc import ABC, abstractmethod
from typing import Dict, List, Set

from src.models.student import Student
from src.models.classroom import Classroom
from src.models.preference import PreferenceTargetType
from src.algorithm.seat_graph import SeatGraph


class BaseAllocator(ABC):
    """
    Base class for all seating allocation algorithms.

    Allocators receive a seat_graph that may already be partially populated:
    - seat_graph.occupants: seats already assigned (will be included in output as-is)
    - seat_graph.locked:    seats the allocator must not move
    - seat_graph.available_seat_ids(): seats free to fill

    Allocators should assign remaining students to available seats and return
    the full assignment dict (pre-existing + new), keyed by furniture_id.
    """

    @abstractmethod
    def allocate(
        self,
        students: List[Student],
        classroom: Classroom,
        seat_graph: SeatGraph,
    ) -> Dict[str, Student]:
        pass


class BogoAllocator(BaseAllocator):
    """Baseline random allocation — respects pre-assigned and locked seats"""

    def allocate(
        self,
        students: List[Student],
        classroom: Classroom,
        seat_graph: SeatGraph,
    ) -> Dict[str, Student]:
        assignments: Dict[str, Student] = dict(seat_graph.occupants)

        placed_ids = {s.id for s in assignments.values()}
        remaining = [s for s in students if s.id not in placed_ids]
        random.shuffle(remaining)

        available = seat_graph.available_seat_ids()
        random.shuffle(available)

        for i, student in enumerate(remaining):
            if i < len(available):
                assignments[available[i]] = student

        return assignments


class GreedyAllocator(BaseAllocator):
    """
    Cost-based greedy allocator.

    Students are sorted by priority (sum of |weights| across all preferences)
    and placed in descending order — most constrained first, so they get the
    widest pick of seats. Each student is assigned to the available seat with
    the lowest marginal cost.

    Marginal cost for student S at seat X:
      - For each of S's preferences targeting an already-placed student or fixture:
          if they would be neighbors → cost += -weight
          (avoid: -(-1) = +1 penalty; prefer: -(+1) = -1 reward)

    Preferences are stored bidirectionally at write time (see src/utils.py), so
    there is no need for a reverse lookup here.

    Tie-breaking among equally-scored seats is random.
    """

    def allocate(
        self,
        students: List[Student],
        classroom: Classroom,
        seat_graph: SeatGraph,
    ) -> Dict[str, Student]:
        assignments: Dict[str, Student] = dict(seat_graph.occupants)

        # student_id -> furniture_id for quick neighbor lookups
        student_to_seat: Dict[str, str] = {s.id: fid for fid, s in assignments.items()}

        # Track which seats are taken (occupants + locked + newly placed as we go)
        taken: Set[str] = set(seat_graph.occupants.keys()) | seat_graph.locked

        placed_ids = set(student_to_seat.keys())
        remaining = [s for s in students if s.id not in placed_ids]

        # Most constrained students first
        remaining.sort(
            key=lambda s: sum(abs(p.weight) for p in s.preferences),
            reverse=True,
        )

        for student in remaining:
            available = [fid for fid in seat_graph.assignable if fid not in taken]
            if not available:
                break

            best_cost = float('inf')
            best_seats: List[str] = []

            for fid in available:
                cost = self._marginal_cost(student, fid, assignments, student_to_seat, seat_graph)
                if cost < best_cost:
                    best_cost = cost
                    best_seats = [fid]
                elif cost == best_cost:
                    best_seats.append(fid)

            chosen = random.choice(best_seats)
            assignments[chosen] = student
            student_to_seat[student.id] = chosen
            taken.add(chosen)

        return assignments

    def _marginal_cost(
        self,
        student: Student,
        seat_fid: str,
        assignments: Dict[str, Student],
        student_to_seat: Dict[str, str],
        seat_graph: SeatGraph,
    ) -> float:
        cost = 0.0

        # This student's own preferences
        for pref in student.preferences:
            if pref.target_type == PreferenceTargetType.STUDENT:
                target_seat = student_to_seat.get(pref.target_id)
                if target_seat and seat_graph.are_neighbors(seat_fid, target_seat):
                    cost -= pref.weight

            elif pref.target_type == PreferenceTargetType.FURNITURE:
                fixture_fid = seat_graph.fixture_id_to_fid.get(pref.target_id)
                if fixture_fid and seat_graph.are_neighbors(seat_fid, fixture_fid):
                    cost -= pref.weight

        return cost
