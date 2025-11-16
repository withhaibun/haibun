Activity: Ensure I have notified the community
    ensure Mail notification letters to immediate neighbors
    ensure Post a sign on the property about the conversion

Activity: Mail notification letters to immediate neighbors
    add 100 to "costs/total"
    add 2 to "time/total"
    set "community/notification/letters" to "sent"
    waypoint "Notification letters" sent to neighbors with variable "community/notification/letters" is "sent"

Activity: Post a sign on the property about the conversion
    add 250 to "costs/total"
    add 1 to "time/total"
    set "community/notification/sign" to "posted"
    waypoint "Public notification sign" posted with variable "community/notification/sign" is "posted"
