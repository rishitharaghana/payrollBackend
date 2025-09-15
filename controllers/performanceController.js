// src/controllers/performanceController.js
const pool = require("../config/db");
const util = require("util");
const queryAsync = util.promisify(pool.query).bind(pool);

const checkEmployeeExists = async (employee_id) => {
  try {
    const query = `
      SELECT employee_id, role, full_name, department_name 
      FROM hrms_users 
      WHERE LOWER(employee_id) = LOWER(?) 
      LIMIT 1
    `;
    const [employee] = await queryAsync(query, [employee_id]);
    return employee || null;
  } catch (err) {
    console.error("checkEmployeeExists - Database error:", {
      error: err.message,
      employee_id,
    });
    throw new Error(`Database error: ${err.message}`);
  }
};

const setEmployeeGoal = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, title, description, due_date, tasks } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can set goals" });
  }

  if (!employee_id || !title || !due_date) {
    return res.status(400).json({ error: "Employee ID, title, and due date are required" });
  }

  if (isNaN(Date.parse(due_date))) {
    return res.status(400).json({ error: "Invalid due date format" });
  }

  try {
    const employee = await checkEmployeeExists(employee_id);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const goalQuery = `
      INSERT INTO goals (goal_id, employee_id, title, description, due_date, created_by)
      VALUES (UUID(), ?, ?, ?, ?, ?)
    `;
    const goalValues = [employee_id, title, description || null, due_date, req.user.employee_id];
    const goalResult = await queryAsync(goalQuery, goalValues);
    const goalId = goalResult.insertId;

    let insertedTasks = [];
    if (tasks && Array.isArray(tasks)) {
      for (const task of tasks) {
        if (!task.title || !task.due_date) {
          throw new Error("Task title and due date are required");
        }
        if (isNaN(Date.parse(task.due_date))) {
          throw new Error(`Invalid due date format for task: ${task.title}`);
        }
        const taskQuery = `
          INSERT INTO tasks (task_id, goal_id, employee_id, title, description, due_date, priority)
          VALUES (UUID(), ?, ?, ?, ?, ?, ?)
        `;
        const taskValues = [
          goalId,
          employee_id,
          task.title,
          task.description || null,
          task.due_date,
          task.priority || "Medium",
        ];
        const taskResult = await queryAsync(taskQuery, taskValues);
        insertedTasks.push({ id: taskResult.insertId, ...task });
      }
    }

    res.status(201).json({
      message: "Goal and tasks set successfully",
      data: { id: goalId, employee_id, title, description, due_date, tasks: insertedTasks },
    });
  } catch (err) {
    console.error("setEmployeeGoal - Database error:", {
      error: err.message,
      employee_id,
    });
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const fetchEmployeePerformance = async (req, res) => {
  const { employee_id } = req.params;
  const userRole = req.user.role;
  const userEmployeeId = req.user.employee_id;

  console.log("fetchEmployeePerformance - Request received:", {
    employee_id,
    userRole,
    userEmployeeId,
  });

  if (!employee_id) {
    return res.status(400).json({ error: "Employee ID is required" });
  }

  if (
    !["super_admin", "hr", "dept_head", "employee"].includes(userRole) ||
    (userRole === "employee" && userEmployeeId !== employee_id)
  ) {
    console.log("fetchEmployeePerformance - Error: Access denied", {
      userRole,
      userEmployeeId,
      employee_id,
    });
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const employee = await checkEmployeeExists(employee_id);
    if (!employee) {
      return res.status(404).json({
        message: "Employee not found",
        data: {
          employee_id,
          full_name: null,
          department_name: null,
          goals: [],
          tasks: [],
          competencies: [],
          achievements: [],
          feedback: [],
          learningGrowth: [],
          appraisals: [],
        },
      });
    }

    if (userRole === "dept_head") {
      const [user] = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = 'dept_head'",
        [userEmployeeId]
      );
      const [targetEmployee] = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ?",
        [employee_id]
      );
      if (
        !user ||
        !targetEmployee ||
        user.department_name !== targetEmployee.department_name
      ) {
        return res.status(403).json({ error: "Access denied: Not in the same department" });
      }
    }

    const goals = await queryAsync(
      "SELECT goal_id AS id, title, description, due_date, progress, status FROM goals WHERE employee_id = ?",
      [employee_id]
    );

    const tasks = await queryAsync(
      "SELECT task_id AS id, goal_id, title, description, due_date, priority, progress, status FROM tasks WHERE employee_id = ?",
      [employee_id]
    );

    const competencies = await queryAsync(
      "SELECT competency_id AS id, skill, self_rating, manager_rating, feedback FROM competencies WHERE employee_id = ?",
      [employee_id]
    );

    const achievements = await queryAsync(
      "SELECT achievement_id AS id, title, date, type FROM achievements WHERE employee_id = ?",
      [employee_id]
    );

    const feedback = await queryAsync(
      "SELECT feedback_id AS id, source, comment, timestamp FROM feedback WHERE employee_id = ?",
      [employee_id]
    );

    const learningGrowth = await queryAsync(
      "SELECT learning_id AS id, title, progress, completed FROM learning_growth WHERE employee_id = ?",
      [employee_id]
    );

    const appraisals = await queryAsync(
      "SELECT appraisal_id AS id, performance_score, manager_comments, bonus_eligible, promotion_recommended, salary_hike_percentage, reviewer_id, created_at FROM appraisals WHERE employee_id = ?",
      [employee_id]
    );

    console.log("fetchEmployeePerformance - Fetched data:", {
      goals: goals || [],
      tasks: tasks || [],
      competencies: competencies || [],
      achievements: achievements || [],
      feedback: feedback || [],
      learningGrowth: learningGrowth || [],
      appraisals: appraisals || [],
    });

    return res.status(200).json({
      message: "Performance data fetched successfully",
      data: {
        employee_id: employee.employee_id,
        full_name: employee.full_name,
        department_name: employee.department_name,
        goals: goals || [],
        tasks: tasks || [],
        competencies: competencies || [],
        achievements: achievements || [],
        feedback: feedback || [],
        learningGrowth: learningGrowth || [],
        appraisals: appraisals || [],
      },
    });
  } catch (err) {
    console.error("fetchEmployeePerformance - Database error:", {
      error: err.message,
      employee_id,
    });
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const submitSelfReview = async (req, res) => {
  const { employee_id, comments } = req.body;
  const userEmployeeId = req.user.employee_id;

  if (userEmployeeId !== employee_id) {
    return res.status(403).json({ error: "Access denied: Can only submit self-review for yourself" });
  }

  if (!comments?.trim()) {
    return res.status(400).json({ error: "Comments are required" });
  }

  try {
    const employee = await checkEmployeeExists(employee_id);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    await queryAsync(
      "INSERT INTO feedback (feedback_id, employee_id, source, comment, timestamp) VALUES (UUID(), ?, ?, ?, NOW())",
      [employee_id, "Self", comments]
    );
    res.status(201).json({ message: "Self-review comments submitted successfully" });
  } catch (err) {
    console.error("submitSelfReview - Database error:", {
      error: err.message,
      employee_id,
    });
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const conductAppraisal = async (req, res) => {
  const userRole = req.user.role;
  const {
    employee_id,
    performance_score,
    manager_comments,
    achievements,
    competencies,
    bonus_eligible,
    promotion_recommended,
    salary_hike_percentage,
    reviewer_id,
  } = req.body;
  const default_reviewer_id = req.user.employee_id;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Only HR or Admin can conduct appraisals" });
  }

  if (!employee_id || !performance_score || !manager_comments) {
    return res.status(400).json({ error: "Employee ID, performance score, and manager comments are required" });
  }

  const score = parseInt(performance_score, 10);
  if (isNaN(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: "Invalid performance score (must be 0-100)" });
  }

  const salaryHike = salary_hike_percentage ? parseFloat(salary_hike_percentage) : 0;
  if (salary_hike_percentage && (isNaN(salaryHike) || salaryHike < 0)) {
    return res.status(400).json({ error: "Invalid salary hike percentage" });
  }

  const effective_reviewer_id = reviewer_id || default_reviewer_id;
  if (!effective_reviewer_id) {
    return res.status(400).json({ error: "Reviewer ID is required and could not be determined" });
  }

  try {
    const employee = await checkEmployeeExists(employee_id);
    if (!employee) {
      return res.status(404).json({ error: `Employee ${employee_id} not found` });
    }

    const reviewer = await checkEmployeeExists(effective_reviewer_id);
    if (!reviewer) {
      return res.status(404).json({ error: `Reviewer ${effective_reviewer_id} not found` });
    }

    const appraisalQuery = `
      INSERT INTO appraisals (appraisal_id, employee_id, performance_score, manager_comments, bonus_eligible, promotion_recommended, salary_hike_percentage, reviewer_id, created_at)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await queryAsync(appraisalQuery, [
      employee_id,
      score,
      manager_comments,
      !!bonus_eligible,
      !!promotion_recommended,
      salaryHike,
      effective_reviewer_id,
    ]);

    if (manager_comments) {
      await queryAsync(
        "INSERT INTO feedback (feedback_id, employee_id, source, comment, timestamp) VALUES (UUID(), ?, ?, ?, NOW())",
        [employee_id, "Manager", manager_comments]
      );
    }

    if (Array.isArray(competencies) && competencies.length > 0) {
      for (const comp of competencies) {
        if (!comp.skill || !comp.manager_rating) {
          throw new Error(`Skill and manager rating are required for competency: ${comp.skill || "unknown"}`);
        }
        const rating = parseInt(comp.manager_rating, 10);
        if (isNaN(rating) || rating < 0 || rating > 10) {
          throw new Error(`Invalid manager rating for skill ${comp.skill} (must be 0-10)`);
        }
        await queryAsync(
          "INSERT INTO competencies (competency_id, employee_id, skill, manager_rating, feedback) VALUES (UUID(), ?, ?, ?, ?)",
          [employee_id, comp.skill, rating, comp.feedback || ""]
        );
      }
    }

    if (Array.isArray(achievements) && achievements.length > 0) {
      for (const ach of achievements) {
        if (!ach.title || !ach.date) {
          throw new Error(`Achievement title and date are required for: ${ach.title || "unknown"}`);
        }
        if (isNaN(Date.parse(ach.date))) {
          throw new Error(`Invalid date format for achievement: ${ach.title}`);
        }
        await queryAsync(
          "INSERT INTO achievements (achievement_id, employee_id, title, date, type) VALUES (UUID(), ?, ?, ?, ?)",
          [employee_id, ach.title, ach.date, ach.type || "Achievement"]
        );
      }
    }

    res.status(201).json({ message: "Appraisal conducted successfully" });
  } catch (err) {
    console.error("conductAppraisal - Database error:", {
      error: err.message,
      employee_id,
      reviewer_id: effective_reviewer_id,
    });
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const updateGoalProgress = async (req, res) => {
  const userRole = req.user.role;
  const { goal_id } = req.params;
  const { progress, status } = req.body;

  if (!["super_admin", "hr", "dept_head", "employee"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  if (
    !progress ||
    !status ||
    !["Not Started", "In Progress", "Completed", "At Risk"].includes(status)
  ) {
    return res.status(400).json({ error: "Progress (0-100) and valid status are required" });
  }

  const progressNum = parseInt(progress, 10);
  if (isNaN(progressNum) || progressNum < 0 || progressNum > 100) {
    return res.status(400).json({ error: "Progress must be a number between 0 and 100" });
  }

  try {
    const [goal] = await queryAsync(
      "SELECT employee_id, created_by FROM goals WHERE goal_id = ?",
      [goal_id]
    );
    if (!goal) {
      return res.status(404).json({ error: "Goal not found" });
    }

    if (userRole === "employee" && goal.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: "Employees can only update their own goals" });
    }

    if (
      userRole === "dept_head" &&
      goal.employee_id !== req.user.employee_id &&
      goal.created_by !== req.user.employee_id
    ) {
      const [employee] = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ?",
        [goal.employee_id]
      );
      const [user] = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = 'dept_head'",
        [req.user.employee_id]
      );
      if (
        !employee ||
        !user ||
        employee.department_name !== user.department_name
      ) {
        return res.status(403).json({
          error: "Department heads can only update their own goals or goals of employees in their department",
        });
      }
    }

    const query =
      "UPDATE goals SET progress = ?, status = ?, updated_at = NOW() WHERE goal_id = ?";
    await queryAsync(query, [progressNum, status, goal_id]);

    res.json({
      message: "Goal progress updated successfully",
      data: { goal_id, progress: progressNum, status },
    });
  } catch (err) {
    console.error("updateGoalProgress - Database error:", {
      error: err.message,
      goal_id,
    });
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

module.exports = {
  setEmployeeGoal,
  checkEmployeeExists,
  updateGoalProgress,
  conductAppraisal,
  fetchEmployeePerformance,
  submitSelfReview,
};