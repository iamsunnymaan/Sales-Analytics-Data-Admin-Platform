package com.houseofbeauty.dto.identity.request;

import java.util.List;

// PUT /api/identity/users/{id}'s body — the "Edit Profile" action's popup (reuses the New User
// modal's fields; Username is editable here too, unlike before). roleIds replaces the user's
// entire role set, it isn't a diff. newPassword is optional — the popup's "Old Password" field is
// a non-editable placeholder (there's nothing to diff against; passwords are only ever stored
// hashed), so blank/null here just means "leave the password as it is". active toggles Is_Active
// (the Status dropdown, Edit Profile only — new users are always created active); it's separate
// from Is_Locked, which this popup doesn't expose.
public record UpdateUserRequest(String username, String fullName, String email, List<Integer> roleIds,
                                 String newPassword, Boolean active) {
}
