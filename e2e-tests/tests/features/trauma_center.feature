Feature: Patient Rights and Hospital Journey

  This feature follows a patient through the hospital. The feature verifies that the patient's fundamental rights are upheld at each stage of care. It shows how a healthcare facility can verify and uphold patient rights.

  A set of Departments is ["Emergency", "Surgery", "Recovery", "General Ward"]
  A set of Care Team is ["Nurse Rached", "Dr. Kildare", "Patient Advocate"]
  A set of Fundamental Rights is ["Privacy", "Informed Consent", "Dignity"]

  Activity: Hospital Admission
  
  The admissions team registers the patient and activates their department status.
  set {department} status to "Active"
  waypoint Patient is admitted to {department} with variable {department} status is "Active"

  Activity: Care Standards
  
  Staff record their commitment to a patient right that needs to be upheld. This activity sets the right's status to Respected.
  set {right} status to "Respected"
  waypoint Right to {right} is upheld with variable {right} status is "Respected"
  
  Staff members sign in to indicate they are attending to the patient.
  set {member} status to "Present"
  waypoint Staff {member} is attending with variable {member} status is "Present"

  Activity: Patient Safety
  
  Patient safety requires that every fundamental right is upheld.
  waypoint Patient is safe with every right in Fundamental Rights is Right to {right} is upheld
  
  At least one care team member must be present as well.
  waypoint Care Team is assembled with some member in Care Team is Staff {member} is attending

  A waypoint can state a precondition. This waypoint checks that a care team member is attending only when the emergency department is open.
  waypoint Emergency response is covered with where variable Emergency status is "Active", some member in Care Team is Staff {member} is attending

  Activity: Environmental Hygiene
  
  Housekeeping is dispatched to an area that isn't clean.
  set {location} status to "Clean"
  waypoint Cleanup Crew is dispatched to {location} with variable {location} status is "Clean"

  Scenario: The Journey of a Patient
  
  A patient arrives at the hospital and moves through several departments. The patient expects their rights to be honoured at every step of their care.

  Admission to Emergency.
  The patient enters the emergency department and is formally admitted.
  set Emergency status to "Active"
  ensure Patient is admitted to "Emergency"

  Rights Protection (whenever).
  The patient's privacy must be protected whenever it is pending review.
  set Privacy status to "Pending"
  whenever variable Privacy status is "Pending", ensure Right to "Privacy" is upheld
  
  Verify Privacy is respected.
  variable Privacy status is "Respected"

  Right to a Clean Environment (whenever).
  The patient has a right to a clean room. Staff must clean the room when it isn't clean.
  set Room 101 status to "Dirty"
  whenever didn't variable Room 101 status is "Clean", ensure Cleanup Crew is dispatched to "Room 101"
  
  Verify Cleanliness.
  variable Room 101 status is "Clean"

  Surgical Intervention (where).
  Surgery requires the patient's informed consent before it proceeds.
  set Surgery status to "Active"
  where variable Surgery status is "Active", ensure Right to "Informed Consent" is upheld
  
  Verify Consent.
  variable Informed Consent status is "Respected"

  Recovery and Staffing (anyOf).
  The patient must not be left alone during recovery. A nurse or an advocate must be present.
  set Recovery status to "Active"
  set Nurse Rached status to "Present"
  any of variable Nurse Rached status is "Present", variable Patient Advocate status is "Present"

  Dignity Assurance.
  The patient's dignity must never be violated.
  ensure Right to "Dignity" is upheld
  didn't variable Dignity status is "Violated"

  Final Safety Check.
  The discharge check ensures that every right was upheld, that the care team was present and that the open emergency department was covered.
  ensure Patient is safe
  ensure Care Team is assembled
  ensure Emergency response is covered
