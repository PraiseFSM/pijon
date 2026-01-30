from dataclasses import dataclass
from typing import List, Tuple, Optional
from enum import Enum

class FurnitureType(Enum):
    SINGLE_DESK = "single_desk"
    TABLE = "table"
    CHAIR = "chair"
    TEACHER_DESK = "teacher_desk"
    # Add more as needed

@dataclass
class Furniture:
    """Base class for all furniture pieces"""
    furniture_id: str
    furniture_type: FurnitureType
    position: Tuple[int, int]  # Top-left corner (x, y) on grid
    width: int  # Grid units wide
    height: int  # Grid units tall
    image_path: str
    rotation: int = 0  # 0, 90, 180, 270 degrees

    
    def get_occupied_cells(self) -> List[Tuple[int, int]]:
        """Returns all grid cells this furniture occupies"""
        cells = []
        for x in range(self.width):
            for y in range(self.height):
                cells.append((self.position[0] + x, self.position[1] + y))
        return cells
    
    def get_seats(self) -> List['Seat']:
        """Returns list of seats this furniture provides"""
        # Override in subclasses
        return []


class SingleDesk(Furniture):
    """A standard single-student desk (1x1 with one seat)"""
    
    def __init__(self, furniture_id: str, position: Tuple[int, int], image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.SINGLE_DESK,
            position=position,
            width=1,
            height=1,
            image_path = image_path,
            rotation=rotation
        )
    
    def get_seats(self) -> List['Seat']:
        from .seat import Seat
        # Single desk has one seat at its position
        return [Seat(
            position=self.position,
            seat_id=f"{self.furniture_id}_seat"
        )]


class Table(Furniture):
    """A table that can have multiple chairs around it"""
    
    def __init__(self, furniture_id: str, position: Tuple[int, int], 
                 width: int, height: int, num_seats: int, 
                 image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.TABLE,
            position=position,
            width=width,
            height=height,
            image_path=image_path,
            rotation=rotation
        )
        self.num_seats = num_seats
    
    def get_seats(self) -> List['Seat']:
        from .seat import Seat
        seats = []
        
        # Distribute seats around the perimeter of the table
        # Simple version: place seats at the corners and midpoints
        x, y = self.position
        
        if self.num_seats == 2:
            # Two seats on opposite sides
            seats.append(Seat(position=(x, y), seat_id=f"{self.furniture_id}_seat_0"))
            seats.append(Seat(position=(x + self.width - 1, y), seat_id=f"{self.furniture_id}_seat_1"))
        
        elif self.num_seats == 4:
            # Four seats, one on each side
            seats.append(Seat(position=(x, y), seat_id=f"{self.furniture_id}_seat_0"))
            seats.append(Seat(position=(x + self.width - 1, y), seat_id=f"{self.furniture_id}_seat_1"))
            seats.append(Seat(position=(x, y + self.height - 1), seat_id=f"{self.furniture_id}_seat_2"))
            seats.append(Seat(position=(x + self.width - 1, y + self.height - 1), seat_id=f"{self.furniture_id}_seat_3"))
        
        elif self.num_seats == 6:
            # Six seats around a rectangular table
            mid_width = self.width // 2
            mid_height = self.height // 2
            
            seats.append(Seat(position=(x, y), seat_id=f"{self.furniture_id}_seat_0"))
            seats.append(Seat(position=(x + mid_width, y), seat_id=f"{self.furniture_id}_seat_1"))
            seats.append(Seat(position=(x + self.width - 1, y), seat_id=f"{self.furniture_id}_seat_2"))
            seats.append(Seat(position=(x, y + self.height - 1), seat_id=f"{self.furniture_id}_seat_3"))
            seats.append(Seat(position=(x + mid_width, y + self.height - 1), seat_id=f"{self.furniture_id}_seat_4"))
            seats.append(Seat(position=(x + self.width - 1, y + self.height - 1), seat_id=f"{self.furniture_id}_seat_5"))
        
        else:
            # For other numbers, distribute evenly (basic version)
            # You can make this smarter later
            for i in range(self.num_seats):
                seats.append(Seat(
                    position=(x + (i % self.width), y + (i // self.width)),
                    seat_id=f"{self.furniture_id}_seat_{i}"
                ))
        
        return seats


class TeacherDesk(Furniture):
    """Teacher's desk - no student seats"""
    
    def __init__(self, furniture_id: str, position: Tuple[int, int], 
                 width: int = 2, height: int = 1, 
                 image_path: Optional[str] = None, rotation: int = 0):
        super().__init__(
            furniture_id=furniture_id,
            furniture_type=FurnitureType.TEACHER_DESK,
            position=position,
            width=width,
            height=height,
            image_path=image_path,
            rotation=rotation
        )
    def get_seats(self) -> List['Seat']:
        # Teacher desk has no student seats
        return []


# Factory function to create furniture easily
def create_furniture(furniture_type: FurnitureType, furniture_id: str, 
                     position: Tuple[int, int], **kwargs) -> Furniture:
    """Factory function to create furniture of different types"""
    
    if furniture_type == FurnitureType.SINGLE_DESK:
        return SingleDesk(
            furniture_id, 
            position, 
            image_path=kwargs.get('image_path'),
            rotation=kwargs.get('rotation', 0)
        )
    
    elif furniture_type == FurnitureType.TABLE:
        return Table(
            furniture_id, 
            position,
            width=kwargs.get('width', 2),
            height=kwargs.get('height', 2),
            num_seats=kwargs.get('num_seats', 4),
            image_path=kwargs.get('image_path'),
            rotation=kwargs.get('rotation', 0)
        )
    
    elif furniture_type == FurnitureType.TEACHER_DESK:
        return TeacherDesk(
            furniture_id,
            position,
            width=kwargs.get('width', 2),
            height=kwargs.get('height', 1),
            image_path=kwargs.get('image_path'),
            rotation=kwargs.get('rotation', 0)
        )
    
    else:
        raise ValueError(f"Unknown furniture type: {furniture_type}")