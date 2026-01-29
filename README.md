<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Classroom Seating App - Development Roadmap</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        
        header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .timeline {
            padding: 40px;
        }
        
        .phase {
            margin-bottom: 40px;
            border-left: 4px solid #667eea;
            padding-left: 30px;
            position: relative;
        }
        
        .phase::before {
            content: '';
            width: 20px;
            height: 20px;
            background: #667eea;
            border-radius: 50%;
            position: absolute;
            left: -12px;
            top: 0;
            border: 4px solid white;
            box-shadow: 0 0 0 2px #667eea;
        }
        
        .phase-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            cursor: pointer;
            padding: 15px;
            background: #f8f9ff;
            border-radius: 8px;
            transition: all 0.3s;
        }
        
        .phase-header:hover {
            background: #eef1ff;
            transform: translateX(5px);
        }
        
        .phase-title {
            font-size: 1.5em;
            color: #667eea;
            font-weight: bold;
        }
        
        .phase-duration {
            background: #667eea;
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.9em;
        }
        
        .phase-content {
            margin-top: 20px;
        }
        
        .phase-content.collapsed {
            display: none;
        }
        
        .milestone {
            background: #f8f9ff;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 15px;
            border-left: 3px solid #764ba2;
        }
        
        .milestone h4 {
            color: #764ba2;
            margin-bottom: 10px;
            font-size: 1.2em;
        }
        
        .task-list {
            list-style: none;
            margin-top: 10px;
        }
        
        .task-list li {
            padding: 8px 0;
            padding-left: 25px;
            position: relative;
            color: #444;
        }
        
        .task-list li::before {
            content: '▹';
            position: absolute;
            left: 0;
            color: #667eea;
            font-weight: bold;
        }
        
        .tech-stack {
            background: #fff5e6;
            padding: 20px;
            border-radius: 8px;
            margin-top: 10px;
        }
        
        .tech-stack h5 {
            color: #ff9800;
            margin-bottom: 10px;
        }
        
        .tech-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        
        .tech-tag {
            background: white;
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.85em;
            border: 1px solid #ff9800;
            color: #ff9800;
        }
        
        .notes {
            background: #e8f5e9;
            padding: 15px;
            border-radius: 8px;
            margin-top: 15px;
            border-left: 3px solid #4caf50;
        }
        
        .notes h5 {
            color: #2e7d32;
            margin-bottom: 8px;
        }
        
        .notes p {
            color: #1b5e20;
            line-height: 1.6;
        }
        
        .summary {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 30px;
            text-align: center;
            margin-top: 20px;
            border-radius: 8px;
        }
        
        .summary h3 {
            font-size: 1.8em;
            margin-bottom: 15px;
        }
        
        .checkbox-container {
            display: inline-flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        
        .checkbox-container input {
            margin-right: 8px;
            cursor: pointer;
            width: 16px;
            height: 16px;
        }
        
        .progress-bar {
            background: #e0e0e0;
            height: 30px;
            border-radius: 15px;
            overflow: hidden;
            margin: 20px 0;
        }
        
        .progress-fill {
            background: linear-gradient(90deg, #4caf50, #8bc34a);
            height: 100%;
            width: 0%;
            transition: width 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎓 Classroom Seating App</h1>
            <p>Development Roadmap - Python Desktop Application</p>
        </header>
        
        <div class="timeline">
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 1: Foundation & Core Data Models</div>
                    <div class="phase-duration">Week 1-2</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>📋 Project Setup</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Set up Python project structure</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create virtual environment</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Install dependencies (PyQt6/Tkinter, pandas, etc.)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Set up version control (Git)</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>🏗️ Core Data Models</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create Student class (name, ID, metadata)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create Desk/Seat class (position, coordinates)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create Classroom class (grid system, furniture list)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Implement distance calculation between seats</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create constraint system (student proximity rules)</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>📁 Import/Export System</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> CSV student list import</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Save/load classroom layouts (JSON)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Save/load seating arrangements</label></li>
                        </ul>
                    </div>
                    
                    <div class="tech-stack">
                        <h5>🛠️ Tech Stack</h5>
                        <div class="tech-tags">
                            <span class="tech-tag">Python 3.10+</span>
                            <span class="tech-tag">pandas</span>
                            <span class="tech-tag">JSON</span>
                            <span class="tech-tag">dataclasses</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 2: Classroom Builder UI</div>
                    <div class="phase-duration">Week 3-4</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>🎨 Grid System</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create adjustable grid canvas</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Implement zoom in/out for grid granularity</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Grid snapping functionality</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Visual grid lines and coordinates</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>🪑 Furniture Management</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Furniture palette (single desk, tables, chairs)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Drag-and-drop furniture placement</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Rotate furniture pieces</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Delete/edit placed furniture</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Multi-seat furniture (tables with multiple chairs)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Visual distinction between furniture types</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>💾 Classroom Management</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Create new classroom</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Save classroom layout</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Load existing classroom</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Classroom selector/switcher</label></li>
                        </ul>
                    </div>
                    
                    <div class="tech-stack">
                        <h5>🛠️ Tech Stack</h5>
                        <div class="tech-tags">
                            <span class="tech-tag">PyQt6 / Tkinter</span>
                            <span class="tech-tag">QGraphicsView</span>
                            <span class="tech-tag">Canvas widgets</span>
                            <span class="tech-tag">Event handlers</span>
                        </div>
                    </div>
                    
                    <div class="notes">
                        <h5>💡 Design Note</h5>
                        <p>Consider using PyQt6's QGraphicsScene for the drag-and-drop functionality - it handles mouse events and collision detection well. Each furniture piece can be a QGraphicsItem.</p>
                    </div>
                </div>
            </div>
            
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 3: Seating Assignment Algorithm</div>
                    <div class="phase-duration">Week 5</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>🧮 Assignment Algorithm</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Random seating assignment (baseline)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Constraint-aware assignment (avoid proximity violations)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Calculate "cost" of arrangement based on constraints</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Iterative improvement algorithm (simulated annealing or genetic algorithm)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Handle edge cases (more students than seats, etc.)</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>📊 Distance Matrix</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Pre-calculate all seat-to-seat distances</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Efficient lookup for constraint checking</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Update distances when classroom layout changes</label></li>
                        </ul>
                    </div>
                    
                    <div class="tech-stack">
                        <h5>🛠️ Tech Stack</h5>
                        <div class="tech-tags">
                            <span class="tech-tag">NumPy</span>
                            <span class="tech-tag">scipy</span>
                            <span class="tech-tag">random</span>
                            <span class="tech-tag">optimization algorithms</span>
                        </div>
                    </div>
                    
                    <div class="notes">
                        <h5>💡 Algorithm Suggestion</h5>
                        <p>Start with a greedy randomized approach, then implement constraint satisfaction. For better results, consider a simple genetic algorithm where each "generation" shuffles a few students and keeps arrangements that reduce constraint violations.</p>
                    </div>
                </div>
            </div>
            
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 4: Student Placement UI</div>
                    <div class="phase-duration">Week 6-7</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>👥 Student Assignment View</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Display classroom with student names on seats</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> "Shuffle" button to generate new arrangement</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Visual loading indicator during shuffle</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Show unassigned students (if more students than seats)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Manual drag-and-drop override for specific students</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>🚦 Constraint Marker System</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Red marker mode: "Can't sit near each other"</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Click pairs of students to create constraints</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Visual indicators of existing constraints (lines, colors)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Remove constraint functionality</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Optional: Green marker for "should sit together"</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Constraint violation highlighting in current arrangement</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>🎯 Interaction Features</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Hover to see student details</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Click student to see their constraints</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Undo/redo functionality</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Save arrangement to file</label></li>
                        </ul>
                    </div>
                    
                    <div class="tech-stack">
                        <h5>🛠️ Tech Stack</h5>
                        <div class="tech-tags">
                            <span class="tech-tag">PyQt6 Signals/Slots</span>
                            <span class="tech-tag">Custom widgets</span>
                            <span class="tech-tag">State management</span>
                            <span class="tech-tag">Event handling</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 5: Polish & Testing</div>
                    <div class="phase-duration">Week 8</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>✨ UI Polish</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Consistent color scheme and styling</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Tooltips and help text</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Keyboard shortcuts</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Responsive layout</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Error messages and validation</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>🧪 Testing</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Unit tests for core algorithms</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Integration tests for UI workflows</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Test with real classroom scenarios</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Edge case testing (empty classroom, 1 student, etc.)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Performance testing with large classrooms</label></li>
                        </ul>
                    </div>
                    
                    <div class="milestone">
                        <h4>📚 Documentation</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> User guide / README</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Code documentation</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Sample data files</label></li>
                        </ul>
                    </div>
                    
                    <div class="tech-stack">
                        <h5>🛠️ Tech Stack</h5>
                        <div class="tech-tags">
                            <span class="tech-tag">pytest</span>
                            <span class="tech-tag">unittest</span>
                            <span class="tech-tag">Sphinx (docs)</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="phase">
                <div class="phase-header" onclick="togglePhase(this)">
                    <div class="phase-title">Phase 6: Optional Enhancements</div>
                    <div class="phase-duration">Future</div>
                </div>
                <div class="phase-content">
                    <div class="milestone">
                        <h4>🚀 Advanced Features</h4>
                        <ul class="task-list">
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Multiple constraint types (friendship groups, learning needs)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Seating history (rotate students over time)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Export to PDF/image for printing</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Templates for common classroom layouts</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Student photos on seats</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Multi-class support (switch between periods/classes)</label></li>
                            <li><label class="checkbox-container"><input type="checkbox" onchange="updateProgress()"> Statistics dashboard (constraint violation trends)</label></li>
                        </ul>
                    </div>
                    
                    <div class="notes">
                        <h5>💡 Nice to Have</h5>
                        <p>These features can be added iteratively based on user feedback and actual usage patterns. Start simple and add complexity as needed!</p>
                    </div>
                </div>
            </div>
            
            <div class="summary">
                <h3>📊 Overall Progress</h3>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressBar">0%</div>
                </div>
                <p style="margin-top: 15px; font-size: 1.1em;">Total Estimated Timeline: <strong>8 weeks</strong></p>
                <p style="margin-top: 10px; opacity: 0.9;">Check off tasks as you complete them to track your progress!</p>
            </div>
        </div>
    </div>
    
    <script>
        function togglePhase(header) {
            const content = header.nextElementSibling;
            content.classList.toggle('collapsed');
        }
        
        function updateProgress() {
            const total = document.querySelectorAll('input[type="checkbox"]').length;
            const checked = document.querySelectorAll('input[type="checkbox"]:checked').length;
            const percentage = Math.round((checked / total) * 100);
            
            const progressBar = document.getElementById('progressBar');
            progressBar.style.width = percentage + '%';
            progressBar.textContent = percentage + '%';
            
            // Save progress to localStorage
            const checkboxes = document.querySelectorAll('input[type="checkbox"]');
            const states = Array.from(checkboxes).map(cb => cb.checked);
            localStorage.setItem('classroomAppProgress', JSON.stringify(states));
        }
        
        // Load progress from localStorage
        window.addEventListener('load', function() {
            const saved = localStorage.getItem('classroomAppProgress');
            if (saved) {
                const states = JSON.parse(saved);
                const checkboxes = document.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach((cb, i) => {
                    if (states[i]) {
                        cb.checked = true;
                    }
                });
                updateProgress();
            }
        });
    </script>
</body>
</html>
