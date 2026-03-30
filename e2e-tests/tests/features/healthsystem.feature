Feature: Health System Guarantees
This feature outlines the promises made to patients regarding access to care emergency response and surgical safety standards.

A set of Vital Signs is ["Pulse", "Breath", "Warmth"]
A set of Public Clinics is ["North Community", "Central Health", "South Clinic"]
A set of Surgical Tools is ["Scalpel", "Forceps", "Clamp"]
A set of Shift Nurses is ["Nurse Joy", "Nurse Jackie", "Nurse Ratched"]

Activity: Standard Protocols
These are the specific checks performed by staff to verify conditions.
waypoint sign {sign} is detected with variable {sign} is "Detected"
waypoint clinic {clinic} is open with variable {clinic} status is "Open"
waypoint tool {tool} is sterile with variable {tool} status is "Sterile"
waypoint nurse {nurse} is alerted with variable {nurse} alert is "Active"

Activity: Patient Guarantees
The logic gates that determine if the system is meeting its obligations to the patient.
waypoint Admission Granted with some sign in Vital Signs is sign {sign} is detected
waypoint Care Found with some clinic in Public Clinics is clinic {clinic} is open
waypoint Safety Verified with every tool in Surgical Tools is tool {tool} is sterile
waypoint Code Red Active with where variable Patient Triage is "Critical", some nurse in Shift Nurses is nurse {nurse} is alerted

Scenario: Unconscious patient admission
A patient arrives unconscious but warm ensuring they are not turned away.
set Pulse to "Faint"
set Breath to "Shallow"
set Warmth to "Detected"
ensure Admission Granted

Scenario: Finding a clinic on a holiday
The North and Central clinics are closed but the system ensures the South clinic is open for care.
set North Community status to "Closed"
set Central Health status to "Closed"
set South Clinic status to "Open"
ensure Care Found

Scenario: Preparing for safe surgery
The patient is assured that infection control protocols are strictly followed for all equipment.
set Scalpel status to "Sterile"
set Forceps status to "Sterile"
set Clamp status to "Sterile"
ensure Safety Verified

Scenario: Emergency Room escalation
A patient condition becomes critical and we verify that at least one nurse has responded to the alarm.
set Patient Triage to "Critical"
set Nurse Joy alert to "Idle"
set Nurse Jackie alert to "Active"
set Nurse Ratched alert to "Idle"
ensure Code Red Active
