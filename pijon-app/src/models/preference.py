from dataclasses import dataclass
from typing import Union, Literal
from enum import Enum


class PreferenceTargetType(Enum):
    """What type of thing this preference is about"""
    STUDENT = "student"
    FURNITURE = "furniture"
    LOCATION = "location"  # For future: regions like "front", "back", "window side"


@dataclass
class Preference:
    """
    A preference/constraint for a student.
    Represents "I want to be near/far from X with strength Y"
    """
    target_type: PreferenceTargetType
    target_id: str  # Student ID, Furniture ID, or location identifier
    weight: float  # Negative = avoid, Positive = prefer, magnitude = importance
    
    def __repr__(self):
        direction = "prefer" if self.weight > 0 else "avoid"
        return f"Preference({direction} {self.target_type.value}:{self.target_id}, weight={self.weight})"
    
    def is_attractive(self) -> bool:
        """Is this an attractive (positive) preference?"""
        return self.weight > 0
    
    def is_repulsive(self) -> bool:
        """Is this a repulsive (negative) preference?"""
        return self.weight < 0
    
    def strength(self) -> float:
        """Absolute strength of the preference"""
        return abs(self.weight)


# Convenience functions for creating preferences
def avoid_student(student_id: str, weight: float = -1.0) -> Preference:
    """Create a preference to avoid sitting near a student"""
    return Preference(
        target_type=PreferenceTargetType.STUDENT,
        target_id=student_id,
        weight=-abs(weight)  # Ensure negative
    )


def prefer_student(student_id: str, weight: float = 1.0) -> Preference:
    """Create a preference to sit near a student"""
    return Preference(
        target_type=PreferenceTargetType.STUDENT,
        target_id=student_id,
        weight=abs(weight)  # Ensure positive
    )


def avoid_furniture(furniture_id: str, weight: float = -1.0) -> Preference:
    """Create a preference to avoid being near furniture"""
    return Preference(
        target_type=PreferenceTargetType.FURNITURE,
        target_id=furniture_id,
        weight=-abs(weight)
    )


def prefer_furniture(furniture_id: str, weight: float = 1.0) -> Preference:
    """Create a preference to be near furniture"""
    return Preference(
        target_type=PreferenceTargetType.FURNITURE,
        target_id=furniture_id,
        weight=abs(weight)
    )


def prefer_location(location_id: str, weight: float = 1.0) -> Preference:
    """Create a preference for a location (e.g., 'front', 'back', 'window')"""
    return Preference(
        target_type=PreferenceTargetType.LOCATION,
        target_id=location_id,
        weight=weight
    )