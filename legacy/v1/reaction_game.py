import streamlit as st
import time


def run_reaction_test(key_prefix: str):
    """
    Shows a dot after 4 seconds.
    User must click when dot appears.
    Returns reaction time in ms.
    """

    # Session keys (scoped by prefix)
    start_key = f"{key_prefix}_start_time"
    visible_key = f"{key_prefix}_dot_visible"
    result_key = f"{key_prefix}_reaction_time"

    # Init state
    if start_key not in st.session_state:
        st.session_state[start_key] = None
        st.session_state[visible_key] = False
        st.session_state[result_key] = None

    # If already completed, show result
    if st.session_state[result_key] is not None:
        st.success(f"Reaction time: {st.session_state[result_key]} ms")
        return st.session_state[result_key]

    # Start button
    if st.session_state[start_key] is None:
        if st.button("Start Reaction Test", key=f"{key_prefix}_start"):
            st.session_state[start_key] = time.time()
            st.session_state[visible_key] = False
            st.rerun()

        return None

    # Wait 4 seconds before showing dot
    elapsed = time.time() - st.session_state[start_key]

    if elapsed < 4:
        st.info("Wait for the dot…")
        time.sleep(0.1)
        st.rerun()

    # Show dot
    st.session_state[visible_key] = True
    st.markdown(
        "<div style='width:80px;height:80px;border-radius:50%;"
        "background-color:#2ecc71;margin:auto;'></div>",
        unsafe_allow_html=True
    )

    # Tap button
    if st.button("Tap Now", key=f"{key_prefix}_tap"):
        reaction_time = round((time.time() - st.session_state[start_key] - 4) * 1000, 2)
        st.session_state[result_key] = max(reaction_time, 0)
        st.rerun()

    return None
