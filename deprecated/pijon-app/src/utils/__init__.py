"""
Shared utilities used across the pijon package.

Keeping these here avoids circular imports and duplicate implementations.
"""
import hashlib
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from src.models.student import Student


# ── Fixture IDs ───────────────────────────────────────────────────────────────

def fixture_id(name: str) -> str:
    """
    Deterministic, salt-free ID for fixture (non-seat) furniture pieces.

    Stable across sessions: the same display name always produces the same ID so
    that student preferences targeting fixtures survive save/load cycles.
    Both csv_handler and seat_graph must use this function — never inline the
    hash logic separately.
    """
    return hashlib.sha256(f"FIXTURE:{name}".encode()).hexdigest()[:12]


# ── Bidirectional student preference helpers ──────────────────────────────────

def mirror_student_preference(source: 'Student', target: 'Student', weight: float) -> None:
    """
    Ensure *target* has a STUDENT preference pointing back at *source* with
    the same *weight*.  If the mirror already exists it is updated in-place;
    otherwise a new preference is appended.

    Call this whenever a STUDENT-type preference is added or its weight changes.
    """
    from src.models.preference import Preference, PreferenceTargetType

    existing = target.get_preference_for(source.id)
    if existing is None:
        target.add_preference(Preference(PreferenceTargetType.STUDENT, source.id, weight))
    elif existing.weight != weight:
        existing.weight = weight


def remove_mirror_preference(source: 'Student', target_id: str, all_students: List['Student']) -> None:
    """
    Remove *source*'s mirror from the target student identified by *target_id*.

    Only removes the preference whose target_id matches source.id — does not
    touch any other preferences the target may have for source.
    """
    target: Optional['Student'] = next((s for s in all_students if s.id == target_id), None)
    if target is not None:
        pref = target.get_preference_for(source.id)
        if pref is not None:
            target.remove_preference(pref)


def enforce_bidirectional(students: List['Student']) -> None:
    """
    After a bulk import or CSV load, ensure every STUDENT-type preference is
    mirrored on the target.  Only *adds* missing mirrors — never overwrites a
    preference that was explicitly set on both sides.
    """
    from src.models.preference import Preference, PreferenceTargetType

    sid_map = {s.id: s for s in students}
    for student in students:
        for pref in list(student.preferences):
            if pref.target_type != PreferenceTargetType.STUDENT:
                continue
            target = sid_map.get(pref.target_id)
            if target is not None and target.get_preference_for(student.id) is None:
                target.add_preference(
                    Preference(PreferenceTargetType.STUDENT, student.id, pref.weight)
                )
