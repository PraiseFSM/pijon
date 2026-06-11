import hashlib
from typing import Dict, List, Set
from src.models.classroom import Classroom
from src.models.furniture import Furniture
from src.models.student import Student


PROXIMITY_THRESHOLD = 1.5  # grid units; 1.5 captures direct + diagonal neighbors


def _fixture_id(name: str) -> str:
    """Same logic as csv_handler.fixture_id — kept local to avoid cross-package import."""
    return hashlib.sha256(f"FIXTURE:{name}".encode()).hexdigest()[:12]


class SeatGraph:
    """
    Graph of furniture nodes linked by proximity.

    Two node types:
    - Assignable seats: furniture with seats — filled by allocators
    - Fixtures: furniture without seats (teacher's desk, board, etc.) —
      permanently locked with sentinel students so the preference system
      can express things like "student with glasses should sit near the board"

    Edges connect all nodes (fixtures included), so are_neighbors() works
    for both student↔student and student↔fixture proximity checks.
    """

    def __init__(self, classroom: Classroom, proximity_threshold: float = PROXIMITY_THRESHOLD):
        self._proximity_threshold = proximity_threshold
        self.nodes: Dict[str, Furniture] = {}           # ALL nodes (assignable + fixture)
        self.edges: Dict[str, List[str]] = {}           # furniture_id -> neighbor ids
        self.assignable: Set[str] = set()               # furniture_ids that accept students
        self.fixtures: Dict[str, Student] = {}          # furniture_id -> sentinel Student
        self.fixture_id_to_fid: Dict[str, str] = {}    # sentinel Student.id -> furniture_id
        self.occupants: Dict[str, Student] = {}         # pre-assigned locked student seats
        self.locked: Set[str] = set()                   # user-locked furniture_ids
        self._build(classroom)

    @property
    def proximity_threshold(self) -> float:
        return self._proximity_threshold

    def set_proximity_threshold(self, value: float, classroom: Classroom):
        """Update proximity threshold and rebuild the graph"""
        self._proximity_threshold = value
        self._build(classroom)

    def _build(self, classroom: Classroom):
        self.nodes.clear()
        self.edges.clear()
        self.assignable.clear()
        self.fixtures.clear()
        self.fixture_id_to_fid.clear()

        for f in classroom.furniture:
            self.nodes[f.furniture_id] = f
            self.edges[f.furniture_id] = []

            if f.get_seats():
                self.assignable.add(f.furniture_id)
            else:
                # Non-seat furniture becomes a fixture node. The sentinel uses a
                # deterministic ID (matching csv_handler.fixture_id) so IDs are
                # consistent whether the fixture came from a CSV import or a classroom load.
                name = f.furniture_type.value.replace("_", " ").title()
                sentinel = Student(
                    id=_fixture_id(name),
                    name=name,
                    metadata={'is_fixture': True}
                )
                self.fixtures[f.furniture_id] = sentinel
                self.fixture_id_to_fid[sentinel.id] = f.furniture_id

        # Edges across ALL nodes so fixtures connect to nearby seats
        all_furniture = list(self.nodes.values())
        for i, f1 in enumerate(all_furniture):
            for f2 in all_furniture[i + 1:]:
                if classroom.furniture_distance(f1, f2) <= self._proximity_threshold:
                    self.edges[f1.furniture_id].append(f2.furniture_id)
                    self.edges[f2.furniture_id].append(f1.furniture_id)

    # -- Assignment state --

    def assign(self, furniture_id: str, student: Student):
        """Pre-assign a student to an assignable seat before running an allocator"""
        self.occupants[furniture_id] = student

    def lock(self, furniture_id: str):
        """Lock a seat so allocators will not move the assigned student"""
        self.locked.add(furniture_id)

    def unlock(self, furniture_id: str):
        self.locked.discard(furniture_id)

    def available_seat_ids(self) -> List[str]:
        """Assignable seats that are free for an allocator to fill"""
        return [
            fid for fid in self.assignable
            if fid not in self.occupants and fid not in self.locked
        ]

    # -- Graph queries --

    def neighbors(self, furniture_id: str) -> List[str]:
        """Return IDs of all nodes adjacent to the given node"""
        return self.edges.get(furniture_id, [])

    def are_neighbors(self, furniture_id_1: str, furniture_id_2: str) -> bool:
        return furniture_id_2 in self.edges.get(furniture_id_1, [])
