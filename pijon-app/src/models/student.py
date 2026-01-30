from dataclasses import dataclass, field
from typing import Optional, Dict

@dataclass
class Student:
    id: str
    name: str
    metadata: Optional[Dict] = field(default_factory=dict)
    
    def __str__(self):
        return self.name
    
    def __repr__(self):
        return f"Student(id='{self.id[:8]}...', name='{self.name}')"