/* -------- HELPER FUNCTIONS -------- */
function findENVScript() {
    const scripts = Array.from(document.scripts);
    const script = scripts.find(s => s.textContent.includes("ENV ="));

    if (script) {
        // Disconnecting observer to prevent repeat calls
        return script;
    }
    return null;
}

function clean_env(env_script) {

    const env_info = env_script.textContent.match(
        /ENV\s*=\s*(\{[\s\S]*?\})\s*;\s*BRANDABLE_CSS_HANDLEBARS_INDEX\s*=/
    );


    const JSON_env_info = JSON.parse(env_info[1]);

    const hide_final_grade = JSON_env_info["hide_final_grades"];
    const submission_info = JSON_env_info["submissions"];
    const assignment_info = JSON_env_info["assignment_groups"];
    const weighting_scheme = JSON_env_info["group_weighting_scheme"];

    return { hide_final_grade, submission_info, assignment_info, weighting_scheme };
}

function get_assignment_points(submission_map, assignment_id) {
    const assignment = submission_map.get(assignment_id);

    // TODO: HAVE BETTER ERROR HANDLING HEREEE
    if (!assignment) {
        console.log("COULDN'T FIND ", assignment_id);
        return null;
    };

    if (assignment["excused"] || assignment["workflow_state"] !== "graded") return null;

    return assignment["score"]
}

function showGroupPoints(group_id, points_earned, total_points) {
    const group_html_element = document.getElementById("submission_group-" + group_id);
    const assignment_score_html = group_html_element.querySelector(".assignment_score");
    const details_html = group_html_element.querySelector(".details");
    const calculated_grade = points_earned / total_points * 100;

    // replace inner html with actual scores & visual format

    assignment_score_html.innerHTML = `
        <div style="position: relative; height: 100%;" class="score_holder">
            <span class="assignment_presenter_for_submission" style="display: none;"></span>
            <span class="react_pill_container"></span>
            <span class="tooltip">
                <span class="grade">` + calculated_grade.toFixed(2) + `</span>
            </span>
        </div>`

    details_html.innerHTML = `<span class="possible points_possible" aria-label="">` + points_earned.toFixed(2) + `/` + total_points.toFixed(2) + `</span>`;

}


// MAIN FUNCTION
function gradeCheck(env_script, grade_html_element) {

    if (!env_script) {
        console.log("Something went wrong... No ENV given");
        grade_html_element.textContent = "No ENV found. Try reloading the page...";
        return;
    }

    let { hide_final_grade, submission_info, assignment_info, weighting_scheme } = clean_env(env_script);

    if (!hide_final_grade) {
        console.log("No need for grade unblocking");
        return;
    };

    // Creating a map for submissions by id
    const submission_map = new Map();

    for (assignment of submission_info) {
        submission_map.set(
            assignment["assignment_id"],
            {
                "excused": assignment["excused"],
                "score": assignment["score"],
                "workflow_state": assignment["workflow_state"]
            }
        );
    }

    // Calculating for each assignment group
    const assignment_group_scores = [];
    let total_weight = 0;

    for (group of assignment_info) {
        if (group["assignments"].length === 0) continue;

        let total_points = 0;
        let points_earned = 0;
        const assignments = [];
        const included_ids = new Set(group["rules"]["never_drop"] ?? []);

        // Go through assignments per group 

        for (assignment of group["assignments"]) {
            if (assignment["omit_from_final_grade"]) continue;

            const points = get_assignment_points(submission_map, assignment["id"]);

            if (points === null) continue;

            if (!included_ids.has(assignment["id"])) {
                assignments.push({
                    "id": assignment["id"],
                    "score": points / assignment["points_possible"],
                    "points_earned": points,
                    "total_points": assignment["points_possible"]
                });
            }

        }

        // Extra rules (for dropping things in the category)

        assignments.sort((a, b) => a["score"] - b["score"]);

        if ("drop_all_but" in group["rules"]) {
            // drop all but the # highest grades
            for (let i = 0; i < group["rules"]["drop_all_but"]; i++) {
                points_earned += assignments[assignments.length - 1 - i]["points_earned"];
                total_points += assignments[assignments.length - 1 - i]["total_points"];
            }
        } else {
            // just add all the total points
            for (const assignment of assignments) {
                points_earned += assignment["points_earned"];
                total_points += assignment["total_points"];
            }

            // CASE 1: Drop the lowest # of grades
            if ("drop_lowest" in group["rules"]) {
                for (let i = 0; i < group["rules"]["drop_lowest"]; i++) {
                    points_earned -= assignments[i]["points_earned"];
                    total_points -= assignments[i]["total_points"];
                }
            }
            // CASE 2: Drop the highest # of grades
            if ("drop_highest" in group["rules"]) {
                for (let i = 0; i < group["rules"]["drop_highest"]; i++) {
                    points_earned -= assignments[assignments.length - 1 - i]["points_earned"];
                    total_points -= assignments[assignments.length - 1 - i]["total_points"];
                }
            }
        }

        if (total_points > 0 || points_earned > 0) {
            // Only a valid category if there has been some opportunity to earn points
            total_weight += group["group_weight"];

            assignment_group_scores.push({
                "group_weight": group["group_weight"],
                "points_earned": points_earned,
                "total_points": total_points
            });

        }

        showGroupPoints(group["id"], points_earned, total_points);


    }

    // Calculating score for different types of weighting

    let calculated_grade = -1;

    if (weighting_scheme === null || weighting_scheme === "points") {
        // CASE 1: No weighted grading at all

        let total_points = 0;
        let points_earned = 0;

        for (group of assignment_group_scores) {
            total_points += group["total_points"];
            points_earned += group["points_earned"];
        }

        calculated_grade = points_earned / total_points * 100;
    } else if (weighting_scheme === "equal") {
        // CASE 2: Weighting in all assignment categories is equal

        let total_average = 0;

        for (group of assignment_group_scores) {
            total_average += group["points_earned"] / group["total_points"];
        }

        calculated_grade = total_average / assignment_group_scores.length * 100;

    } else if (weighting_scheme === "percent") {
        // CASE 3: Weighted average

        let weighted_average = 0;

        for (group of assignment_group_scores) {

            if (group["total_points"] === 0) continue;

            const group_grade = group["points_earned"] / group["total_points"]
            const group_weight = group["group_weight"] / total_weight
            weighted_average += group_grade * group_weight;

        }

        calculated_grade = weighted_average * 100;
    }

    console.log("CALCULATED GRADE", calculated_grade)

    grade_html_element.textContent = "Total: " + calculated_grade.toFixed(2) + "%";

}

// Finding ENV
console.log("Finding ENV...")

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            const found = findENVScript();
            let grade_html_element = document.getElementById("student-grades-final");

            let rightSidebar = document.getElementById("student-grades-right-content");

            if (grade_html_element == null) {
                grade_html_element = rightSidebar?.getElementsByClassName("student_assignment final_grade")[0];
            }

            const env_info = found?.textContent.match(
                /ENV\s*=\s*(\{[\s\S]*?\})\s*;\s*BRANDABLE_CSS_HANDLEBARS_INDEX\s*=/
            );

            if (found && env_info && grade_html_element) {
                observer.disconnect();
                console.log("Found ENV.. Calculating grade");
                gradeCheck(found, grade_html_element);
                break;
            };
        }
    }
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});
