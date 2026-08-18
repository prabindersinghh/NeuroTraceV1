import streamlit as st
from datetime import date
import pandas as pd

# ---------------- Internal Imports ----------------
from auth import patient_login
from patient_store import (
    load_patient,
    is_baseline_done,
    store_baseline,
    store_daily
)
from trend_utils import prepare_reaction_trend
from risk_trend_utils import prepare_risk_trend

from speech_analysis import extract_speech_features
from face_analysis import analyze_face
from reaction_game import run_reaction_test
from risk_engine import calculate_risk
from explainability import explain_risk


# ---------------- Page Config ----------------
st.set_page_config(
    page_title="NeuroTrace",
    layout="wide",
    initial_sidebar_state="collapsed"
)

st.markdown("""
<style>
/* Main background */
.stApp {
    background-color: #f8fbff;
}

/* All text default */
html, body, [class*="css"] {
    color: #0b1f33 !important;
}

/* Headings */
h1, h2, h3, h4 {
    color: #0d47a1 !important;
}

/* Captions & markdown */
.stCaption, .stMarkdown {
    color: #1a1a1a !important;
}

/* Info boxes */
.stAlert {
    background-color: #e3f2fd !important;
    color: #0b1f33 !important;
}

/* Buttons */
.stButton > button {
    background-color: #1a73e8 !important;
    color: #ffffff !important;
    border-radius: 8px;
    border: none;
    font-weight: 600;
}

/* File uploader */
[data-testid="stFileUploader"] {
    background-color: #ffffff !important;
    border: 1px solid #cfd8dc !important;
}

/* Charts background */
[data-testid="stLineChart"] {
    background-color: #ffffff !important;
}

/* Remove dark sidebar blocks */
section[data-testid="stSidebar"] {
    background-color: #f8fbff !important;
}

/* ===== RADIO BUTTON TEXT FIX (IMPORTANT) ===== */

/* Force all radio text visible */
div[data-testid="stRadio"] * {
    color: #0b1f33 !important;
    font-weight: 600 !important;
}

/* Extra safety for nested spans */
div[data-testid="stRadio"] label span {
    color: #0b1f33 !important;
}

/* ================================================= */

</style>
""", unsafe_allow_html=True)


st.title("🧠 NeuroTrace")
st.caption("At-Home Neurological Stability Monitoring")


# ---------------- Login ----------------
patient_id = st.session_state.get("patient_id") or patient_login()
if not patient_id:
    st.stop()

st.success(f"Logged in as: {patient_id}")


# ---------------- Load Status ----------------
baseline_done = is_baseline_done(patient_id)

# ---------------- Layout ----------------
left_col, right_col = st.columns([2, 1])


# ==================================================
# 🔵 BASELINE DAY (ONLY ONCE)
# ==================================================
if not baseline_done:
    with left_col:
        st.markdown("## 🔵 Baseline Day Setup")

        age = st.selectbox("Age Range", ["18–30", "31–45", "46–60", "60+"])
        gender = st.selectbox("Gender (optional)", ["Prefer not to say", "Male", "Female"])
        stroke_type = st.selectbox("Stroke Type", ["Ischemic", "Hemorrhagic", "Unknown"])
        days_since = st.selectbox("Days since discharge", ["0–7", "8–30", "30+"])
        dominant_hand = st.selectbox("Dominant hand", ["Left", "Right"])

        consent = st.checkbox("I understand this tool does NOT provide medical diagnosis.")

        video = st.file_uploader(
            "Upload face video (mp4)",
            type=["mp4"],
            key="baseline_video"
        )

        audio = st.file_uploader(
            "Upload voice sample (.wav)",
            type=["wav"],
            key="baseline_audio"
        )

        st.markdown("### 🎯 Reaction Test")
        reaction_time = run_reaction_test("baseline")

        if st.button("Create Baseline", key="create_baseline"):
            if not consent:
                st.error("Consent is required.")
            elif not video or not audio or reaction_time is None:
                st.error("All baseline inputs are required.")
            else:
                face = analyze_face(video)
                speech = extract_speech_features(audio)

                baseline = {
                    **face,
                    **speech,
                    "reaction_time": reaction_time
                }

                profile = {
                    "age": age,
                    "gender": gender,
                    "stroke_type": stroke_type,
                    "days_since": days_since,
                    "dominant_hand": dominant_hand
                }

                store_baseline(patient_id, profile, baseline)

                st.success(
                    "Baseline stored successfully. "
                    "Please return daily at the same time."
                )
                st.rerun()


# ==================================================
# 🟢 DAILY CHECK (AFTER BASELINE)
# ==================================================
else:
    patient_data = load_patient(patient_id)

    with left_col:
        st.markdown("## 🟢 Daily Check")

        audio = st.file_uploader(
            "Upload voice sample (.wav)",
            type=["wav"],
            key="daily_audio"
        )

        video = st.file_uploader(
            "Upload face video (mp4)",
            type=["mp4"],
            key="daily_video"
        )

        st.markdown("### 🎯 Reaction Test")
        reaction_time = run_reaction_test("daily")

        self_state = st.radio(
            "How are you feeling today?",
            ["Same", "Slightly off", "Worse"],
            key="self_state"
        )

        if st.button("Analyze Today", key="analyze_today"):
            if not audio or not video or reaction_time is None:
                st.error("All daily inputs are required.")
            else:
                baseline = patient_data.get("baseline")

                temp_current = {
                    **extract_speech_features(audio),
                    **analyze_face(video),
                    "reaction_time": reaction_time,
                    "self_report": self_state,
                    "date": str(date.today())
                }

                risk = calculate_risk(baseline, temp_current)
                explanation = explain_risk(baseline, temp_current, risk)

                current = {
                    **temp_current,
                    "risk_level": risk["risk_level"],
                    "risk_score": risk["risk_score"]
                }

                store_daily(patient_id, current)
                patient_data = load_patient(patient_id)

                with right_col:
                    st.markdown("## ⚠️ Risk Assessment")
                    st.json(risk)

                    st.markdown("### Explanation")
                    st.write(explanation)


# ==================================================
# 📈 TRENDS (ONLY IF BASELINE EXISTS)
# ==================================================
if baseline_done:
    with left_col:
        st.markdown("## 📈 Reaction Time Trend")

        trend_df = prepare_reaction_trend(patient_data)

        if not trend_df.empty:
            st.line_chart(trend_df.set_index("date")["reaction_time"])

            baseline_rt = patient_data["baseline"]["reaction_time"]
            latest_rt = trend_df.iloc[-1]["reaction_time"]
            delta = round(latest_rt - baseline_rt, 2)

            if delta > 0:
                st.warning(f"Reaction time slower than baseline by {delta} ms")
            else:
                st.success(f"Reaction time faster than baseline by {abs(delta)} ms")

        st.caption(
            "Trend shows deviation from personal baseline over time, "
            "not population averages."
        )

        st.markdown("## 🚦 Neurological Risk Trend")

        risk_df = prepare_risk_trend(patient_data)

        if not risk_df.empty:
            # Use risk_score if available, else fallback to risk_level
            risk_column = "risk_score" if "risk_score" in risk_df.columns else "risk_level"

        st.line_chart(
            risk_df.set_index("date")[risk_column]
)

        st.caption(
            "Risk trend derived from multi-modal deviation from personal baseline."
        )


# ==================================================
# ☁️ Azure Architecture & Safety
# ==================================================
st.markdown("## ☁️ Azure Production Architecture")

st.markdown("""
**Current MVP:**  
• Local processing for rapid prototyping  
• Streamlit-based interaction  

**Production-ready Azure Mapping:**  
• Patient data → Azure Blob Storage  
• Trend & risk analysis → Azure Functions  
• AI models → Azure Machine Learning  
• Speech features → Azure Speech AI  
• Facial analysis → Azure AI Vision  
""")

st.markdown("## ⚖️ Responsible AI & Medical Safety")

st.info("""
NeuroTrace does NOT diagnose medical conditions.

The system detects **deviations from a patient’s personal neurological baseline**
and highlights trends that may require human attention.

All clinical decisions remain with qualified healthcare professionals.
""")
