In addition to federal programs, the provincial government offers its own set of incentives.
These are often targeted at specific regional priorities, such as green energy.
I will investigate these to further improve the project's budget.

Activity: Ensure I have checked for provincial incentives
    ensure Apply for provincial rebates for solar panel installation
    ensure Apply for low-interest loans for insulation upgrades

Applying for these incentives requires a separate set of applications and documentation.

Activity: Apply for provincial rebates for solar panel installation
    Solar panels are a significant investment, but provincial rebates can make them much more affordable.
    This will also lead to long-term savings on electricity bills.
    add -5000 to "costs/total"
    add 12 to "time/total"
    set "provincial/incentives/solar" to "applied"
    waypoint Applied for provincial incentive "solar panel rebates" with variable "provincial/incentives/solar" is "applied"

Activity: Apply for low-interest loans for insulation upgrades
    Proper insulation is crucial for energy efficiency.
    The province offers low-interest financing to help homeowners with this upgrade.
    add -1000 to "costs/total"
    add 6 to "time/total"
    set "provincial/incentives/insulation" to "applied"
    waypoint Applied for provincial incentive "insulation loans" with variable "provincial/incentives/insulation" is "applied"
