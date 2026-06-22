from dataclasses import dataclass
from typing import List, Tuple, Optional
from enum import Enum


class FurnitureType(Enum):
    SINGLE_DESK  = "single_desk"
    TABLE        = "table"
    CHAIR        = "chair"
    TEACHER_DESK = "teacher_desk"


@dataclass
class Furniture:
    """Base class for all furniture pieces."""
    furniture_id:   str
    furniture_type: FurnitureType
    position:       Tuple[int, int]
    width:          int
    height:         int
    image_path:     Optional[str]
    rotation:       int = 0

    def get_occupied_cells(self) -> List[Tuple[int, int]]:
        """All grid cells this furniture occupies."""
        return [
            (self.position[0] + dx, self.position[1] + dy)
            for dx in range(self.width)
            for dy in range(self.height)
        ]

    def seat_count(self) -> int:
        """Number of student seats this furniture provides. Override in subclasses."""
        return 0


class SingleDesk(Furniture):
    """Standard single-student desk — 1×1 cell, one seat."""

    def __init__(self, furniture_id: str, position: Tuple[int, int],
                 image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.SINGLE_DESK,
            position=position,
            width=1, height=1,
            image_path=image_path,
            rotation=rotation,
        )

    def seat_count(self) -> int:
        return 1


class Table(Furniture):
    """Multi-seat table with configurable dimensions."""

    def __init__(self, furniture_id: str, position: Tuple[int, int],
                 width: int, height: int, num_seats: int,
                 image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.TABLE,
            position=position,
            width=width, height=height,
            image_path=image_path,
            rotation=rotation,
        )
        self.num_seats = num_seats

    def seat_count(self) -> int:
        return self.num_seats


class TeacherDesk(Furniture):
    """Teacher's desk — no student seats (fixture node in the seat graph)."""

    def __init__(self, furniture_id: str, position: Tuple[int, int],
                 width: int = 2, height: int = 1,
                 image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.TEACHER_DESK,
            position=position,
            width=width, height=height,
            image_path=image_path,
            rotation=rotation,
        )

    def seat_count(self) -> int:
        return 0


def create_furniture(furniture_type: FurnitureType, furniture_id: str,
                     position: Tuple[int, int], **kwargs) -> Furniture:
    """Factory for creating furniture by type."""
    if furniture_type == FurnitureType.SINGLE_DESK:
        return SingleDesk(furniture_id, position,
                          image_path=kwargs.get('image_path'),
                          rotation=kwargs.get('rotation', 0))
    if furniture_type == FurnitureType.TABLE:
        return Table(furniture_id, position,
                     width=kwargs.get('width', 2),
                     height=kwargs.get('height', 2),
                     num_seats=kwargs.get('num_seats', 4),
                     image_path=kwargs.get('image_path'),
                     rotation=kwargs.get('rotation', 0))
    if furniture_type == FurnitureType.TEACHER_DESK:
        return TeacherDesk(furniture_id, position,
                           width=kwargs.get('width', 2),
                           height=kwargs.get('height', 1),
                           image_path=kwargs.get('image_path'),
                           rotation=kwargs.get('rotation', 0))
    raise ValueError(f"Unknown furniture type: {furniture_type}")
