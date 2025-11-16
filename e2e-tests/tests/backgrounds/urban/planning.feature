Activity: Ensure I have met urban planning requirements
    ensure Submit triplex conversion plans for review
    ensure Obtain building permits
    ensure Pass all required inspections

Activity: Submit triplex conversion plans for review
    add 2000 to "costs/total"
    add 20 to "time/total"
    set "urban/planning/plans" to "submitted"
    waypoint "Triplex conversion plans" submitted with variable "urban/planning/plans" is "submitted"

Activity: Obtain building permits
    ensure Submit triplex conversion plans for review
    add 3000 to "costs/total"
    add 30 to "time/total"
    set "urban/planning/permits" to "obtained"
    waypoint "Building permits" obtained with variable "urban/planning/permits" is "obtained"

Activity: Pass all required inspections
    ensure Obtain building permits
    ensure Pass foundation inspection
    ensure Pass framing inspection
    ensure Pass rough-ins inspection
    ensure Pass insulation inspection
    ensure Pass final inspections

Activity: Pass foundation inspection
    add 1000 to "costs/total"
    add 3 to "time/total"
    set "urban/inspections/foundation" to "passed"
    waypoint "Foundation inspection" passed with variable "urban/inspections/foundation" is "passed"

Activity: Pass framing inspection
    add 1000 to "costs/total"
    add 3 to "time/total"
    set "urban/inspections/framing" to "passed"
    waypoint "Framing inspection" passed with variable "urban/inspections/framing" is "passed"

Activity: Pass rough-ins inspection
    add 1500 to "costs/total"
    add 5 to "time/total"
    set "urban/inspections/rough_ins" to "passed"
    waypoint "Electrical and plumbing rough-in inspections" passed with variable "urban/inspections/rough_ins" is "passed"

Activity: Pass insulation inspection
    add 800 to "costs/total"
    add 2 to "time/total"
    set "urban/inspections/insulation" to "passed"
    waypoint "Insulation inspection" passed with variable "urban/inspections/insulation" is "passed"

Activity: Pass final inspections
    add 2500 to "costs/total"
    add 8 to "time/total"
    set "urban/inspections/final" to "passed"
    waypoint "Final building inspections" passed with variable "urban/inspections/final" is "passed"

Activity: Obtain occupancy permit
    ensure Pass final inspections
    add 500 to "costs/total"
    add 10 to "time/total"
    set "urban/occupancy_permit" to "obtained"
    waypoint "Occupancy permit" obtained with variable "urban/occupancy_permit" is "obtained"
