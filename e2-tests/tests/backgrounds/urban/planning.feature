Urban planning is where the project really takes shape.
This phase involves submitting detailed plans to the city and obtaining the necessary permits to begin construction.
It is the most complex part of the pre-construction process.

Activity: Ensure I have met urban planning requirements
    ensure Submit triplex conversion plans for review
    ensure Obtain building permits
    ensure Pass all required inspections

Each of these steps is a major milestone in the project.

Activity: Submit triplex conversion plans for review
    The architectural drawings and engineering specifications must be submitted to the city's planning department.
    They will review the plans for compliance with all local bylaws and regulations.
    add 2000 to "costs/total"
    add 20 to "time/total"
    set "urban/planning/plans" to "submitted"
    waypoint "Triplex conversion plans" submitted with variable "urban/planning/plans" is "submitted"

Activity: Obtain building permits
    Once the plans are approved, the city will issue the building permits.
    No construction work can begin until these permits are posted on the property.
    ensure Submit triplex conversion plans for review
    add 3000 to "costs/total"
    add 30 to "time/total"
    set "urban/planning/permits" to "obtained"
    waypoint "Building permits" obtained with variable "urban/planning/permits" is "obtained"

The inspection process is a series of checkpoints to ensure the construction is up to code.

Activity: Pass all required inspections
    ensure Obtain building permits
    ensure Pass foundation inspection
    ensure Pass framing inspection
    ensure Pass rough-ins inspection
    ensure Pass insulation inspection
    ensure Pass final inspections

Each inspection must be passed before the next phase of construction can begin.

Activity: Pass foundation inspection
    The inspector checks the footings and foundation walls before the ground floor is framed.
    add 1000 to "costs/total"
    add 3 to "time/total"
    set "urban/inspections/foundation" to "passed"
    waypoint "Foundation inspection" passed with variable "urban/inspections/foundation" is "passed"

Activity: Pass framing inspection
    This inspection verifies that the wall, floor, and roof framing is structurally sound.
    add 1000 to "costs/total"
    add 3 to "time/total"
    set "urban/inspections/framing" to "passed"
    waypoint "Framing inspection" passed with variable "urban/inspections/framing" is "passed"

Activity: Pass rough-ins inspection
    Before any drywall is installed, the electrical wiring and plumbing pipes are inspected.
    add 1500 to "costs/total"
    add 5 to "time/total"
    set "urban/inspections/rough_ins" to "passed"
    waypoint "Electrical and plumbing rough-in inspections" passed with variable "urban/inspections/rough_ins" is "passed"

Activity: Pass insulation inspection
    The insulation and vapor barrier are checked to ensure they meet energy efficiency standards.
    add 800 to "costs/total"
    add 2 to "time/total"
    set "urban/inspections/insulation" to "passed"
    waypoint "Insulation inspection" passed with variable "urban/inspections/insulation" is "passed"

Activity: Pass final inspections
    Once the construction is complete, a final set of inspections is performed.
    This includes a final review of the electrical, plumbing, and overall building structure.
    add 2500 to "costs/total"
    add 8 to "time/total"
    set "urban/inspections/final" to "passed"
    waypoint "Final building inspections" passed with variable "urban/inspections/final" is "passed"

Activity: Obtain occupancy permit
    The final step is to obtain the occupancy permit.
    This permit certifies that the building is safe to live in.
    ensure Pass final inspections
    add 500 to "costs/total"
    add 10 to "time/total"
    set "urban/occupancy_permit" to "obtained"
    waypoint "Occupancy permit" obtained with variable "urban/occupancy_permit" is "obtained"
