import streamlit as st

def patient_login():
    st.markdown("## 🔐 Patient Sign In")

    patient_id = st.text_input(
        "Patient ID or Email",
        placeholder="e.g. patient001 or user@email.com"
    )

    if st.button("Continue"):
        if not patient_id.strip():
            st.error("Patient ID required")
            return None
        st.session_state.patient_id = patient_id
        return patient_id

    return None
