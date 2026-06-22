"""Shared fixtures for all tests."""
import pytest
from src.models.classroom import Classroom
from src.models.furniture import SingleDesk, TeacherDesk
from src.models.student import Student
from src.models.preference import Preference, PreferenceTargetType


def make_classroom(*desks):
    """Return a 20x20 classroom containing the given furniture objects."""
    c = Classroom("test_room", 20, 20)
    for d in desks:
        c.add_furniture(d)
    return c


def desk(fid, x, y):
    return SingleDesk(fid, (x, y))


def teacher_desk(fid, x, y):
    return TeacherDesk(fid, (x, y))


def student(sid, name, *prefs):
    s = Student(id=sid, name=name)
    for p in prefs:
        s.add_preference(p)
    return s


def avoid(target_id, weight=-1.0):
    return Preference(PreferenceTargetType.STUDENT, target_id, weight)


def prefer(target_id, weight=1.0):
    return Preference(PreferenceTargetType.STUDENT, target_id, weight)
