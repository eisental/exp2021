import './App.css';
import React from 'react';
import ls from 'local-storage';
import { readSessionData, writeSessionEvent, SessionEvent, does_user_sheet_exists } from './sessions.js';
import { LoadingScreen, ErrorScreen, InfoScreen, classNames } from './ui.js';
import { texts } from './text.js';
import gs from './spreadsheet_io.js';
import { LoginScreen } from './login.js';
import { SubjectDataScreen } from './subject_data.js';
import { PictureSamplesScreen } from './picture_samples.js';
import { Experiment } from './experiment.js';
import { counterbalance, shuffleArray, randomElement, randomInt } from './randomize.js';
import { blocks } from './stimuli.js';
import { FinalQuestionsScreen } from './final_questions.js';

const FinishScreen = ({ done_saving, data_save_error, language }) => {
    return (
        <div className={classNames("container", language === "hebrew" && "text-right")} dir={language === "hebrew" && "rtl"}>
            <div className="row justify-content-center">
                <div className="col-md-8 finish-screen">
                    {texts[language].finish.done}
                    <p className="font-weight-bold">{done_saving ? texts[language].finish_success : texts[language].finish_wait}</p>
                    <p className="alert-error">{data_save_error}</p>
                </div>
            </div>
        </div>
    );
};

class App extends React.Component {
    conn = {
        spreadsheet_id: '1O3uiSh1z1V2UjcxOu6FfelqUrgZRI2HNBQ2f12jjjjg',
        api_key: 'AIzaSyDHFHbGy_GhEt1Q4FW61YYEX2jk3hZcSoQ',
        write_url: 'https://script.google.com/macros/s/AKfycbwQHtJwrLIE4_Ry5uDXtH1hZJg6xvUNUP-8kBqYTtGs2gENHMlbyFNE13CYXaMdx0H3vQ/exec'
    }

    steps = {
        LOGIN: 1,
        SUBJECT_DATA: 2,
        INTRO: 3,
        PICTURE_SAMPLES: 4,
        EXPERIMENT_BLOCKS: 5,
        FINAL_QUESTIONS: 6,
        FINISH: 7,
    }

    state = {
        step: 1,
        error: null,
        data_save_error: null,
        loading: false,
    }

    data = {
        trials: [],
        language: "english",
    }

    componentDidMount() {
        this.data.start_time = new Date().toString();
    }

    nextStep = () => {
        const { step } = this.state;
        this.setStep(step + 1);
    }

    stepWillChange = (prev_step, next_step) => {
        if (prev_step === this.steps.LOGIN) {
            this.handle_login();
        }
        else if (prev_step === this.steps.SUBJECT_DATA) {
            ls.set("data", this.data);
        }

        return null;
    }

    setStep = (new_step) => {
        const { step } = this.state;
        if (new_step !== step) {
            const altered_step = this.stepWillChange(step, new_step);
            if (altered_step) {
                new_step = altered_step;
            }

            if (new_step > 2) {
                ls.set("step", new_step);
            }

            this.setState({ step: new_step });
            this.stepChanged(new_step);
        }
    }

    stepChanged = (step) => {
        if (step === this.steps.FINISH) {
            this.save_data();
        }
    }

    check_for_subject_sheet = () => {
        return does_user_sheet_exists(this.conn, this.data.id)
            .then(sheet_exists => {
                if (sheet_exists) {
                    return true;
                }
                else {
                    this.setState({
                        error: texts[this.data.language].error_no_user_sheet + this.data.id,
                        loading: false
                    });
                    return false;
                }
            })
            .catch(err => {
                this.setState({ error: texts[this.data.language].error_no_connection + " (" + err + ")." });
            });
    }

    
    load_exp1_recordings = () => {
        return gs.read(this.conn, "FirstExperimentTrials", "A2:H10000")
            .then(res => res.json())
            .then(exp1_data => this.exp1_recordings = exp1_data.values);
    }

    // PILOT: We use a partial list of the first experiment trials
    // load_exp1_recordings = () => {
    //     return gs.read(this.conn, "PilotFirstExperimentTrials", "B2:G769")
    //         .then(res => res.json())
    //         .then(exp1_data => this.exp1_recordings = exp1_data.values);
    // }

    handle_login = () => {
        this.setState({ loading: true });

        this.check_for_subject_sheet()
            .then(found_sheet => {
                if (found_sheet) {
                    readSessionData(this.conn)
                        .then(sessions => {
                            const previous_sessions = sessions.filter(e => e.id === this.data.id);
                            if (previous_sessions.length === 0) {
                                // First session. Not continued!
                                this.start_new_session(1);
                            }
                            else {
                                // Not first session or continued session.
                                const last_session = previous_sessions[previous_sessions.length - 1];
                                const last_session_number = parseInt(last_session.session);

                                if (last_session.event !== SessionEvent.SESSION_END) {
                                    // Continue session
                                    this.continue_session(last_session_number);
                                }
                                else {
                                    // PILOT: In the pilot we have a single session (change to: === 2 for two sessions)
                                    // Last session ended. 
                                    if (last_session_number === 1) {
                                        this.setState({
                                            error: texts[this.data.language].error_2nd_session_over,
                                            loading: false
                                        });
                                    }
                                    else {
                                        // Second session
                                        this.start_new_session(2);
                                    }
                                }
                            }
                        })
                        .catch(err => {
                            this.setState({ error: texts[this.data.language].error_no_connection + " (" + err + ")." });
                        });
                }
            });
    }

    start_new_session = (number) => {
        console.log("Start new session:", number);
        this.data.session = number;

        const start_session = () => {
            console.log("Clearing local storage");
            ls.clear();
            ls.set("data", this.data);

            if (number === 2 && this.state.step === this.steps.SUBJECT_DATA) {
                this.nextStep();
            }
            this.load_exp1_recordings()
                .then(() => {
                    ls.set("exp1_recordings", this.exp1_recordings);
                    this.setState({ loading: false });
                });
        };

        writeSessionEvent(this.conn, this.data, SessionEvent.SESSION_START);
        if (number === 1) {
            this.generate_subject_settings()
                .then(() => {
                    this.setState({ loading: false });
                    start_session();
                });
        }
        else {

            this.load_subject_settings()
                .then(start_session);
        }
    }

    continue_session = (number) => {
        console.log("Continue session:", number);
        const cont_data = ls.get("data");
        if (cont_data && cont_data.id === this.data.id) {
            this.data = cont_data;
            writeSessionEvent(this.conn, this.data, SessionEvent.SESSION_CONTINUED);
            this.load_subject_settings()
                .then(() => this.setState({ loading: false }));

            const exp1_recordings = ls.get("exp1_recordings");
            if (exp1_recordings) {
                this.exp1_recordings = exp1_recordings;
            }
            else {
                this.load_exp1_recordings();
            }

            const cont_step = ls.get("step");
            if (cont_step) {
                if (cont_step === this.steps.SUBJECT_DATA && number === 2) {
                    this.setStep(cont_step + 1);
                }
                else {
                    this.setStep(cont_step);
                }
            }
        }
        else {
            this.start_new_session(number);
        }
    }

    generate_subject_settings = () => {
        return gs.read(this.conn, "Subjects", "A2:I10000")
            .then(res => res.json())
            .then(subjects_sheet => {
                if (!subjects_sheet.values) {
                    // first subject
                    this.data.picture_samples_order = 0;
                    this.data.picture_variant = 1;
                    this.data.left_picture = 0;
                    this.data.blocks_order = 0;

                    const exp1_subjects = shuffleArray([0, 1, 2, 3, 4, 5, 6, 7]);
                    this.data.subject_Mu_E = exp1_subjects[0];
                    this.data.subject_Mu_H = exp1_subjects[1];
                    this.data.subject_Sp_E = exp1_subjects[2];
                    this.data.subject_Sp_H = exp1_subjects[3];
                }
                else {
                    const prev_settings = subjects_sheet.values;
                    const prev_group_settings = prev_settings.filter(r => r[1] === this.data.group);

                    // Picture samples order
                    const prev_picture_samples = prev_settings.map(r => r[2]);
                    this.data.picture_samples_order = counterbalance(6, prev_picture_samples);

                    // Picture variant
                        
                    const prev_group_variants = prev_group_settings.map(r => r[3] - 1);
                    this.data.picture_variant = counterbalance(2, prev_group_variants) + 1;

                    // Picture order in a single trial
                    const prev_left_picture = prev_settings.map(r => r[4]);
                    this.data.left_picture = counterbalance(2, prev_left_picture);

                    // Exp1 participant per block
                    if (prev_group_settings.length === 0) {
                        this.data.subject_Mu_E = randomInt(0, 8); // No english speakers in exp1
                        this.data.subject_Mu_H = randomInt(0, 10);
                        this.data.subject_Sp_E = randomInt(0, 8);
                        this.data.subject_Sp_H = randomInt(0, 11);

                        this.data.blocks_order = 0;
                    }
                    else {
                        const prev_subject_Mu_E = prev_group_settings.map(r => r[5]);
                        const prev_subject_Mu_H = prev_group_settings.map(r => r[6]);
                        const prev_subject_Sp_E = prev_group_settings.map(r => r[7]);
                        const prev_subject_Sp_H = prev_group_settings.map(r => r[8]);
                        const prev_blocks_order = prev_group_settings.map(r => r[9]);

                        this.data.subject_Mu_E = counterbalance(8, prev_subject_Mu_E);
                        
                        this.data.subject_Mu_H = counterbalance(10, prev_subject_Mu_H, [5]); // exclude Mu_H_5 since only did half

                        this.data.subject_Sp_E = counterbalance(8, prev_subject_Sp_E);
                        this.data.subject_Sp_H = counterbalance(11, prev_subject_Sp_H);
                        this.data.blocks_order = counterbalance(2, prev_blocks_order);
                    }
                }

                this.data.blocks = blocks(this.data);
                console.log('blocks', this.data.blocks);

                const subject_row = Object.assign({}, this.data);
                subject_row.blocks = JSON.stringify(subject_row.blocks);
                return gs.write(this.conn, "Subjects", subject_row);
            });
    };

    load_subject_settings = () => {
        return gs.read(this.conn, "Subjects", "A2:J10000")
            .then(res => res.json())
            .then(subjects_sheet => {
                if (!subjects_sheet.values) {
                    this.setState({ error: texts[this.data.language].error_no_subject_settings + this.data.id });
                }
                else {
                    // find last settings row for participant id
                    const rows = subjects_sheet.values.filter(row => row[0] === this.data.id);
                    if (rows.length === 0) {
                        this.setState({ error: texts[this.data.language].error_no_subject_settings + this.data.id });
                    }
                    else {
                        const settings_row = rows[rows.length - 1];
                        this.data.group = settings_row[1];
                        this.data.picture_samples_order = settings_row[2];
                        this.data.picture_variant = settings_row[3];
                        this.data.left_picture = settings_row[4];
                        this.data.subject_Mu_E = settings_row[5];
                        this.data.subject_Mu_H = settings_row[6];
                        this.data.subject_Sp_E = settings_row[7];
                        this.data.subject_Sp_H = settings_row[8];
                        this.data.blocks_order = settings_row[9];
                        this.data.blocks = blocks(this.data)
                    }
                }
            });
    };

    save_data = () => {

        this.data.end_time = new Date().toString();
        this.data.trials.forEach(t => {
            t.id = this.data.id;
            t.session = this.data.session;
            t.start_time = this.data.start_time;
            t.end_time = this.data.end_time;
            if (this.data.session === 1) {
                t.gender = this.data.gender;
                t.age = this.data.age;
                t.musical_instrument = this.data.musical_instrument;
                t.music_theory = this.data.music_theory;
                t.activity = this.data.activity;
                t.activity_specify = this.data.activity_specify;
                t.acting = this.data.acting;
                t.strategy = this.data.strategy;
                t.relationships = this.data.relationships;
                t.feedback = this.data.feedback;
            }
        });
        console.log(this.data);

        const that = this;
        gs.write(this.conn, this.data.id, this.data.trials)
            .then(res => {
                that.setState({ done_saving: true });
                writeSessionEvent(this.conn, this.data, SessionEvent.SESSION_END);
            })
            .catch(this.show_data_save_error);

    }

    render() {
        const { step, loading, error } = this.state;

        if (error) {
            return <ErrorScreen error={error} language={this.data.language} />;
        }
        else if (loading) {
            return <LoadingScreen language={this.data.language} />;
        }
        else {
            switch (step) {
                case this.steps.LOGIN:
                    return <LoginScreen next={this.nextStep} data={this.data} key={step} />;
                case this.steps.SUBJECT_DATA:
                    return <SubjectDataScreen next={this.nextStep} data={this.data} key={step} language={this.data.language} />;
                case this.steps.INTRO:
                    return <InfoScreen next={this.nextStep} rtl={this.data.language === "hebrew"}
                        info={texts[this.data.language].introduction}
                        continue_label={texts[this.data.language].continue_label}
                        key={step} />;
                case this.steps.PICTURE_SAMPLES:
                    return <PictureSamplesScreen
                        language={this.data.language}
                        next={this.nextStep}
                        semantic_fields_permutation={this.data.picture_samples_order}
                        picture_variant={this.data.picture_variant}
                        picture_orientation={randomElement(['Right', 'Left'])}
                        key={step} />;
                case this.steps.EXPERIMENT_BLOCKS:
                    return <Experiment next={this.nextStep}
                        data={this.data}
                        exp1_recordings={this.exp1_recordings}
                        key={step} />;
                case this.steps.FINAL_QUESTIONS:
                    return <FinalQuestionsScreen next={this.nextStep} data={this.data} />;
                case this.steps.FINISH:
                    return <FinishScreen done_saving={this.state.done_saving} key={step} language={this.data.language} />;
                default:
                    return null;
            }
        }
    }
}

export default App;
