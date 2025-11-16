Provincial regulations build upon the federal framework with rules specific to the region.
This includes zoning laws and specific amendments to the building code.
Compliance is mandatory and will be checked by municipal inspectors.

Activity: Ensure I have reviewed provincial regulations
    ensure Review provincial zoning regulations for multi-unit dwellings
    ensure Review provincial fire code updates

This review will ensure the project is viable on this specific property.

Activity: Review provincial zoning regulations for multi-unit dwellings
    I need to confirm that the property is zoned for a multi-unit dwelling like a triplex.
    This step might involve a formal request to the provincial planning authority.
    add 1200 to "costs/total"
    add 8 to "time/total"
    set "provincial/regulations/zoning" to "reviewed"
    waypoint Reviewed "provincial zoning regulations" with variable "provincial/regulations/zoning" is "reviewed"

Activity: Review provincial fire code updates
    The provincial fire code has specific requirements for multi-family homes, such as fire separations and alarm systems.
    These must be incorporated into the design.
    add 600 to "costs/total"
    add 4 to "time/total"
    set "provincial/regulations/fire_code" to "reviewed"
    waypoint Reviewed "provincial fire code updates" with variable "provincial/regulations/fire_code" is "reviewed"
