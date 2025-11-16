Feature: Haibun Overview - A guide to specification-driven development.

Scenario: The what, why, and how of Haibun.

This is a story about a house.
It is a single-family home.
set "dwelling.type" to "single-family"

The owners want to convert it into a multi-unit dwelling.
This is a complex project with many steps.
It requires careful planning and execution.
This is where Haibun comes in.
Haibun is a tool for managing complex projects.
It helps to ensure that all requirements are met.
It does this by using a "verifiable manual" approach.
The manual is a set of instructions that can be automatically verified.
Each step in the manual is a "waypoint proof".
This ensures that the project is on track.
Let's start by defining the project goals.
The goal is to convert the house into a triplex.
set "project.goal" to "triplex"

The project must also meet all building codes.
set "project.requirements.building_codes" to "true"

And the project must be completed within a certain budget.
set "project.budget" to "100000"

An alternative to Haibun's verifiable manual is a "solver".
A solver is a tool that can find a solution to a problem.
It does this by exploring a large search space of possible solutions.
However, solvers can be difficult to use for large, complex projects.
They can also be difficult to maintain as the project evolves.
Haibun, on the other hand, is designed to be practical and maintainable.
It does this by using a combination of prose and steppers.
The prose describes the "what" and "why" of the project.
The steppers describe the "how".
This makes the project easy to understand for both technical and non-technical people.

Activity: Obtain permits
Parties: Homeowner, Municipality
waypoint Zoning permit approved with "zoning_permit.status" set to "approved"
waypoint Building permit approved with "building_permit.status" set to "approved"

Activity: Redesign interior
Parties: Homeowner, Architect, Contractor
ensure Obtain permits
waypoint Architectural plans approved with "architectural_plans.status" set to "approved"
waypoint Structural plans approved with "structural_plans.status" set to "approved"
waypoint Electrical plans approved with "electrical_plans.status" set to "approved"
waypoint Plumbing plans approved with "plumbing_plans.status" set to "approved"

Activity: Frame new walls
Parties: Contractor, Building Inspector
ensure Redesign interior
waypoint Framing inspection passed with "framing_inspection.status" set to "passed"

Activity: Install plumbing
Parties: Contractor, Plumber, Building Inspector
ensure Frame new walls
waypoint Plumbing inspection passed with "plumbing_inspection.status" set to "passed"

Activity: Install electrical
Parties: Contractor, Electrician, Building Inspector
ensure Frame new walls
waypoint Electrical inspection passed with "electrical_inspection.status" set to "passed"

Activity: Finish interior
Parties: Contractor, Painter, Flooring Installer
ensure Install plumbing
ensure Install electrical
waypoint Final inspection passed with "final_inspection.status" set to "passed"

Scenario: Full conversion to triplex
ensure Finish interior
variable "dwelling.type" is "triplex"

This example demonstrates how Haibun can be used to manage a complex project.
The project is broken down into a series of smaller, manageable Activities.
Each Activity has a clear set of prerequisites and outcomes.
This makes it easy to track the progress of the project.
And to ensure that all requirements are met.
The use of domain-specific steppers for each trade would further enhance the clarity and maintainability of the project.
This concludes the overview of Haibun.
