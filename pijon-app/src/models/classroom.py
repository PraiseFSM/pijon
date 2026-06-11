from typing import List, Tuple, Optional
import json
from pathlib import Path
from .furniture import Furniture, FurnitureType

class Classroom:
    def __init__(self, name: str, grid_width: int, grid_height: int):
        self.name = name
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.furniture: List[Furniture] = []
        
    def furniture_distance(self, f1: Furniture, f2: Furniture) -> float:
        """Euclidean distance between the centers of two furniture pieces"""
        cx1 = f1.position[0] + f1.width / 2
        cy1 = f1.position[1] + f1.height / 2
        cx2 = f2.position[0] + f2.width / 2
        cy2 = f2.position[1] + f2.height / 2
        return ((cx2 - cx1) ** 2 + (cy2 - cy1) ** 2) ** 0.5

    def add_furniture(self, furniture: Furniture):
        """Add furniture to classroom"""
        self.furniture.append(furniture)
        
    def remove_furniture(self, furniture: Furniture):
        """Remove furniture from classroom"""
        if furniture in self.furniture:
            self.furniture.remove(furniture)
    
    def clear_furniture(self):
        """Remove all furniture"""
        self.furniture.clear()
    
    def to_dict(self) -> dict:
        furniture_data = []
        
        for f in self.furniture:
            f_dict = {
                "furniture_id": f.furniture_id,
                "furniture_type": f.furniture_type.value,
                "position": f.position,
                "width": f.width,
                "height": f.height,
                "image_path": f.image_path,
                "rotation": f.rotation
            }
            
            # Save num_seats for tables
            if hasattr(f, 'num_seats'):
                f_dict["num_seats"] = f.num_seats
            
            furniture_data.append(f_dict)
        
        return {
            "name": self.name,
            "grid_width": self.grid_width,
            "grid_height": self.grid_height,
            "furniture": furniture_data
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Classroom':
        from .furniture import SingleDesk, Table, TeacherDesk  # Import subclasses
        
        classroom = cls(
            name=data["name"],
            grid_width=data["grid_width"],
            grid_height=data["grid_height"]
        )
        
        for f_data in data["furniture"]:
            furniture_type = FurnitureType(f_data["furniture_type"])
            
            # Create the appropriate subclass based on type
            if furniture_type == FurnitureType.SINGLE_DESK:
                furniture = SingleDesk(
                    furniture_id=f_data["furniture_id"],
                    position=tuple(f_data["position"]),
                    image_path=f_data.get("image_path"),
                    rotation=f_data.get("rotation", 0)
                )
            elif furniture_type == FurnitureType.TABLE:
                furniture = Table(
                    furniture_id=f_data["furniture_id"],
                    position=tuple(f_data["position"]),
                    width=f_data["width"],
                    height=f_data["height"],
                    num_seats=f_data.get("num_seats", 4),  # Default to 4 if not specified
                    image_path=f_data.get("image_path"),
                    rotation=f_data.get("rotation", 0)
                )
            elif furniture_type == FurnitureType.TEACHER_DESK:
                furniture = TeacherDesk(
                    furniture_id=f_data["furniture_id"],
                    position=tuple(f_data["position"]),
                    width=f_data["width"],
                    height=f_data["height"],
                    image_path=f_data.get("image_path"),
                    rotation=f_data.get("rotation", 0)
                )
            else:
                # Fallback to generic Furniture for unknown types
                furniture = Furniture(
                    furniture_id=f_data["furniture_id"],
                    furniture_type=furniture_type,
                    position=tuple(f_data["position"]),
                    width=f_data["width"],
                    height=f_data["height"],
                    image_path=f_data.get("image_path"),
                    rotation=f_data.get("rotation", 0)
                )
            
            classroom.add_furniture(furniture)
        
        return classroom
    
    def save_to_file(self, directory: Path = Path("data/classrooms")):
        """Save classroom to JSON file"""
        directory.mkdir(parents=True, exist_ok=True)
        filepath = directory / f"{self.name}.json"
        
        with open(filepath, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
        
        print(f"Saved classroom to {filepath}")
        return filepath
    
    @classmethod
    def load_from_file(cls, filepath: Path) -> 'Classroom':
        """Load classroom from JSON file"""
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        return cls.from_dict(data)
    
    @classmethod
    def list_saved_classrooms(cls, directory: Path = Path("data/classrooms")) -> List[str]:
        """List all saved classroom names"""
        if not directory.exists():
            return []
        
        return [f.stem for f in directory.glob("*.json")]