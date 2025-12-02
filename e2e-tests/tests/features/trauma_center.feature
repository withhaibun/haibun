Feature: Patient Rights and Hospital Journey

  This feature follows a patient's story through the hospital system, ensuring their fundamental rights are protected at every stage.

  A set of Departments is ["Emergency", "Surgery", "Recovery", "General Ward"]
  A set of Care Team is ["Nurse Rached", "Dr. Kildare", "Patient Advocate"]
  A set of Fundamental Rights is ["Privacy", "Informed Consent", "Dignity"]

  Activity: Hospital Admission
  
  waypoint Patient is admitted to {department} with variable {department} status is "Active"

  Activity: Care Standards
  
  waypoint Right to {right} is upheld with variable {right} status is "Respected"
  waypoint Staff {member} is attending with variable {member} status is "Present"

  Activity: Patient Safety
  
  waypoint Patient is safe with every right in Fundamental Rights is Right to {right} is upheld
  waypoint Care Team is assembled with some member in Care Team is Staff {member} is attending

  Activity: Environmental Hygiene
  
  set {location} status to "Clean"
  waypoint Cleanup Crew is dispatched to {location} with variable {location} status is "Clean"

  Scenario: The Journey of a Patient
  
  A patient arrives at the hospital and moves through various departments, expecting their rights to be honoured.

  Admission to Emergency.
  The patient enters the ER.
  set Emergency status to "Active"
  ensure Patient is admitted to "Emergency"

  Rights Protection (whenever).
  At any time the patient is in a new department, their privacy must be explicitly protected.
  set Privacy status to "Pending"
  whenever variable Privacy status is "Pending", set Privacy status to "Respected"
  
  Verify Privacy is respected.
  ensure Right to "Privacy" is upheld

  Right to a Clean Environment (whenever).
  The patient has a right to a clean room. If it is not clean, staff must rectify it.
  set Room 101 status to "Dirty"
  whenever not variable Room 101 status is "Clean", ensure Cleanup Crew is dispatched to Room 101
  
  Verify Cleanliness.
  variable Room 101 status is "Clean"

  Surgical Intervention (where).
  If the patient needs surgery, informed consent is mandatory before proceeding.
  set Surgery status to "Active"
  where variable Surgery status is "Active", set Informed Consent status to "Respected"
  
  Verify Consent.
  ensure Right to "Informed Consent" is upheld

  Recovery and Staffing (anyOf).
  During recovery, the patient must not be left alone; either a nurse or an advocate must be present.
  set Recovery status to "Active"
  set Nurse Rached status to "Present"
  any of variable Nurse Rached status is "Present", variable Patient Advocate status is "Present"

  Dignity Assurance (not).
  The patient's dignity must never be violated.
  set Dignity status to "Respected"
  not variable Dignity status is "Violated"

  Final Safety Check.
  Before discharge, we ensure all rights were upheld and the team was present.
  ensure Patient is safe
  ensure Care Team is assembled
