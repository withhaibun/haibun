A project of this scale requires a team of qualified professionals.
I will need to hire an architect, a structural engineer, and a general contractor.
Their expertise is essential for a successful and code-compliant conversion.

Activity: Ensure I have hired all necessary specialists
    ensure Hire an architect
    ensure Hire a structural engineer
    ensure Hire a general contractor

Each of these specialists plays a crucial role in the project.

Activity: Hire an architect
    The architect will be responsible for creating the detailed plans and blueprints for the triplex.
    Their design will be the foundation for the entire project.
    add 8000 to "costs/total"
    add 40 to "time/total"
    set "private/specialists/architect" to "hired"
    waypoint Hired "an architect for plans and design" with variable "private/specialists/architect" is "hired"

Activity: Hire a structural engineer
    The structural engineer will ensure that the proposed changes are safe and structurally sound.
    They will calculate load-bearing requirements and specify necessary reinforcements.
    add 5000 to "costs/total"
    add 30 to "time/total"
    set "private/specialists/engineer" to "hired"
    waypoint Hired "a structural engineer for load-bearing calculations" with variable "private/specialists/engineer" is "hired"

Activity: Hire a general contractor
    The general contractor will oversee the entire construction process.
    They will manage subcontractors, schedule inspections, and ensure the project stays on track and on budget.
    add 15000 to "costs/total"
    add 25 to "time/total"
    set "private/specialists/contractor" to "hired"
    waypoint Hired "a general contractor to manage construction" with variable "private/specialists/contractor" is "hired"
