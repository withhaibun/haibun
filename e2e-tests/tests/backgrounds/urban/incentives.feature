Cities often have their own incentive programs to encourage specific types of development.
These can range from grants for green infrastructure to tax breaks for preserving local heritage.
I will look into these local opportunities.

Activity: Ensure I have checked for urban incentives
    ensure Apply for city grants for green roof installation
    ensure Apply for property tax breaks for heritage home preservation

These applications are handled by the municipal government and require a separate process.

Activity: Apply for city grants for green roof installation
    A green roof would be an excellent feature for the triplex, providing insulation and aesthetic value.
    The city offers a generous grant to help cover the installation costs.
    add -4000 to "costs/total"
    add 15 to "time/total"
    set "urban/incentives/green_roof" to "applied"
    waypoint Applied for urban incentive "green roof grant" with variable "urban/incentives/green_roof" is "applied"

Activity: Apply for property tax breaks for heritage home preservation
    If the house has heritage status, preserving its facade could qualify for a property tax reduction.
    This provides a long-term financial benefit.
    add -1500 to "costs/total"
    add 10 to "time/total"
    set "urban/incentives/heritage_tax" to "applied"
    waypoint Applied for urban incentive "heritage tax break" with variable "urban/incentives/heritage_tax" is "applied"
