import csv
import hashlib
import secrets
from typing import List
from src.models.student import Student


class StudentImporter:
    def __init__(self):
        self.salt = secrets.token_hex(16)
    
    def parse_csv(self, file_path: str) -> List[str]:
        """Parse CSV file and extract student names"""
        student_names = []
        
        with open(file_path, 'r', encoding='utf-8') as file:
            csv_reader = csv.reader(file)
            
            # Skip header if present
            first_row = next(csv_reader, None)
            if first_row:
                if first_row[0].lower() in ['name', 'student', 'student name','students','names']:
                    pass  # Skip header
                else:
                    student_names.append(first_row[0].strip())
            
            # Read remaining rows
            for row in csv_reader:
                if row and row[0].strip():
                    student_names.append(row[0].strip())
        
        return student_names
    
    def create_student_list(self, names: List[str]) -> List[Student]:
        """Create Student objects with hashed IDs from list of names"""
        students = []
        
        for name in names:
            # Create hash from name + salt
            hash_input = f"{name}{self.salt}".encode('utf-8')
            student_id = hashlib.sha256(hash_input).hexdigest()[:12]
            
            student = Student(
                id=student_id,
                name=name,
                metadata={}
            )
            students.append(student)
        
        return students
    
    def import_from_csv(self, file_path: str) -> List[Student]:
        """Convenience method: parse CSV and create students in one step"""
        names = self.parse_csv(file_path)
        return self.create_student_list(names)