from dataclasses import dataclass, field
from typing import Optional, Dict, List
from .preference import Preference, PreferenceTargetType


@dataclass
class Student:
    id: str
    name: str
    metadata: Optional[Dict] = field(default_factory=dict)
    preferences: List['Preference'] = field(default_factory=list)  # NEW
    
    def __str__(self):
        return self.name
    
    def __repr__(self):
        return f"Student(id='{self.id[:8]}...', name='{self.name}', prefs={len(self.preferences)})"
    
    # Preference management methods
    
    def add_preference(self, preference: 'Preference'):
        """Add a preference/constraint for this student"""
        self.preferences.append(preference)
    
    def remove_preference(self, preference: 'Preference'):
        """Remove a preference"""
        if preference in self.preferences:
            self.preferences.remove(preference)
    
    def get_student_preferences(self) -> List['Preference']:
        """Get all preferences about other students"""
        return [p for p in self.preferences if p.target_type == PreferenceTargetType.STUDENT]
    
    def get_furniture_preferences(self) -> List['Preference']:
        """Get all preferences about furniture"""
        return [p for p in self.preferences if p.target_type == PreferenceTargetType.FURNITURE]
    
    def get_location_preferences(self) -> List['Preference']:
        """Get all preferences about locations"""
        return [p for p in self.preferences if p.target_type == PreferenceTargetType.LOCATION]
    
    def get_preference_for(self, target_id: str) -> Optional['Preference']:
        """Get preference for a specific target (student/furniture)"""
        for pref in self.preferences:
            if pref.target_id == target_id:
                return pref
        return None
    
    def has_preference_for(self, target_id: str) -> bool:
        """Check if student has any preference for this target"""
        return self.get_preference_for(target_id) is not None
    
    def clear_preferences(self):
        """Remove all preferences"""
        self.preferences.clear()
    
    def to_dict(self) -> dict:
        """Convert to dictionary for serialization"""
        return {
            "id": self.id,
            "name": self.name,
            "metadata": self.metadata,
            "preferences": [
                {
                    "target_type": p.target_type.value,
                    "target_id": p.target_id,
                    "weight": p.weight
                }
                for p in self.preferences
            ]
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Student':
        """Create student from dictionary"""
        
        student = cls(
            id=data["id"],
            name=data["name"],
            metadata=data.get("metadata", {}),
            preferences=[]
        )
        
        # Load preferences
        for p_data in data.get("preferences", []):
            pref = Preference(
                target_type=PreferenceTargetType(p_data["target_type"]),
                target_id=p_data["target_id"],
                weight=p_data["weight"]
            )
            student.add_preference(pref)
        
        return student