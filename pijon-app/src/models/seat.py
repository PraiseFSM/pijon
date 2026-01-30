from dataclasses import dataclass
from typing import Tuple, Optional

@dataclass
class Seat:
    position: Tuple[int, int]  # (x, y) grid coordinates
    seat_id: str
    occupied_by: Optional['Student'] = None
    
    def distance_to(self, other: 'Seat') -> float:
        """Calculate Euclidean distance to another seat"""
        x1, y1 = self.position
        x2, y2 = other.position
        return ((x2 - x1)**2 + (y2 - y1)**2)**0.5
