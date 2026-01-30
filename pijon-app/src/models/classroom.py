from typing import List, Dict
from .seat import Seat
from .furniture import Furniture

class Classroom:
    def __init__(self, name: str, grid_width: int, grid_height: int):
        self.name = name
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.furniture: List[Furniture] = []
        self.seats: List[Seat] = []
        
    def add_furniture(self, furniture: Furniture):
        self.furniture.append(furniture)
        # TODO
        # Extract seats from furniture and add to seats list
        
    def get_distance_matrix(self) -> Dict:
        # TODO
        pass
