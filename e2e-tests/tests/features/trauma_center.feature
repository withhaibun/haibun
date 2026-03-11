Feature: Patient Rights and Hospital Journey

  This feature follows a patient's story through the hospital system, ensuring their fundamental rights are protected at every stage. It demonstrates how healthcare facilities can systematically verify and uphold patient rights throughout their care journey.

  A set of Departments is ["Emergency", "Surgery", "Recovery", "General Ward"]
  A set of Care Team is ["Nurse Rached", "Dr. Kildare", "Patient Advocate"]
  A set of Fundamental Rights is ["Privacy", "Informed Consent", "Dignity"]

  Activity: Hospital Admission
  
  The admissions team registers the patient and activates their department status.
  set {department} status to "Active"
  waypoint Patient is admitted to {department} with variable {department} status is "Active"

  Activity: Care Standards
  
  When a patient right needs to be upheld, staff acknowledge, address and document their commitment to that right. This activity ensures the right is explicitly respected.
  set {right} status to "Respected"
  waypoint Right to {right} is upheld with variable {right} status is "Respected"
  
  Staff members sign in to indicate they are attending to the patient.
  set {member} status to "Present"
  waypoint Staff {member} is attending with variable {member} status is "Present"

  Activity: Patient Safety
  
  Patient safety requires that all fundamental rights are verified.
  waypoint Patient is safe with every right in Fundamental Rights is Right to {right} is upheld
  
  Additionally, at least one care team member must be present.
  waypoint Care Team is assembled with some member in Care Team is Staff {member} is attending

  Activity: Environmental Hygiene
  
  When an area is not clean, housekeeping is dispatched to restore it.
  set {location} status to "Clean"
  waypoint Cleanup Crew is dispatched to {location} with variable {location} status is "Clean"

  Scenario: The Journey of a Patient
  
  A patient arrives at the hospital and moves through various departments, expecting their rights to be honoured at every step of their care.

  Admission to Emergency.
  The patient enters the ER and is formally admitted to the department.
  set Emergency status to "Active"
  ensure Patient is admitted to "Emergency"

  Rights Protection (whenever).
  At any time the patient's privacy is pending review, it must be explicitly protected.
  set Privacy status to "Pending"
  whenever variable Privacy status is "Pending", ensure Right to Privacy is upheld
  
  Verify Privacy is respected.
  variable Privacy status is "Respected"

  Right to a Clean Environment (whenever).
  The patient has a right to a clean room. If it is not clean, staff must rectify it.
  set Room 101 status to "Dirty"
  whenever not variable Room 101 status is "Clean", ensure Cleanup Crew is dispatched to Room 101
  
  Verify Cleanliness.
  variable Room 101 status is "Clean"

  Surgical Intervention (where).
  If the patient needs surgery, informed consent is mandatory before proceeding.
  set Surgery status to "Active"
  where variable Surgery status is "Active", ensure Right to Informed Consent is upheld
  
  Verify Consent.
  variable Informed Consent status is "Respected"

  Recovery and Staffing (anyOf).
  During recovery, the patient must not be left alone; either a nurse or an advocate must be present.
  set Recovery status to "Active"
  set Nurse Rached status to "Present"
  any of variable Nurse Rached status is "Present", variable Patient Advocate status is "Present"

  Dignity Assurance.
  The patient's dignity must never be violated.
  ensure Right to Dignity is upheld
  not variable Dignity status is "Violated"

  Final Safety Check.
  Before discharge, we ensure all rights were upheld and the team was present.
  ensure Patient is safe
  ensure Care Team is assembled
