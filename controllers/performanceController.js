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
    const results = await queryAsync(query, [employee_id]);
    return results[0] || null;
  } catch (err) {
    console.error("checkEmployeeExists - Database error:", {
      error: err.message,
      employee_id,
    });
    throw new Error(`Database error: ${err.message}`);
  }
};

const setEmployeeGoal = async (req, res) => {
  const { employee_id, title, description, due_date, tasks } = req.body;
  const created_by = req.user.employee_id;

  if (!employee_id || !title || !due_date) {
    return res.status(400).json({ error: "Employee ID, title, and due date are required" });
  }

  if (new Date(due_date) < new Date()) {
    return res.status(400).json({ error: "Due date must be in the future" });
  }

  try {
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const employee = await checkEmployeeExists(employee_id);
      if (!employee) {
        throw new Error(`Employee ${employee_id} not found`);
      }

      // Insert goal
      const goalQuery = `
        INSERT INTO goals (employee_id, title, description, due_date, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `;
      const goalResult = await new Promise((resolve, reject) => {
        connection.query(goalQuery, [employee_id, title, description || null, due_date, created_by], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      const goalId = goalResult.insertId;

      // Insert tasks
      const taskPromises = (Array.isArray(tasks) ? tasks : []).map((task) => {
        if (!task.title || !task.due_date) {
          throw new Error("Task title and due date are required");
        }
        if (!["Low", "Medium", "High"].includes(task.priority)) {
          task.priority = "Medium";
        }
        if (!["Pending", "In Progress", "Completed"].includes(task.status)) {
          task.status = "Pending";
        }
        const taskQuery = `
          INSERT INTO tasks (goal_id, employee_id, title, description, due_date, priority, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        return new Promise((resolve, reject) => {
          connection.query(taskQuery, [goalId, employee_id, task.title, task.description || null, task.due_date, task.priority, task.status], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      });

      await Promise.all(taskPromises);

      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.status(201).json({
        message: "Goal set successfully",
        data: {
          goal_id: goalId,
          employee_id,
          title,
          description,
          due_date,
          tasks,
        },
      });
    } catch (error) {
      await new Promise((resolve, reject) => {
        connection.rollback(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      throw error;
    } finally {
      connection.release();
    }
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
          bonuses: [],
        },
      });
    }

    if (userRole === "dept_head") {
      const user = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = 'dept_head'",
        [userEmployeeId]
      );
      const targetEmployee = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ?",
        [employee_id]
      );
      if (
        !user[0] ||
        !targetEmployee[0] ||
        user[0].department_name !== targetEmployee[0].department_name
      ) {
        return res.status(403).json({ error: "Access denied: Not in the same department" });
      }
    }

    const goalsQuery = `
      SELECT id, title, description, due_date, progress, status
      FROM goals
      WHERE employee_id = ?
    `;
    const tasksQuery = `
      SELECT task_id AS id, goal_id, title, description, due_date, priority, status
      FROM tasks
      WHERE employee_id = ?
    `;
    const competenciesQuery = `
      SELECT id, skill, self_rating, manager_rating, feedback
      FROM competencies
      WHERE employee_id = ?
    `;
    const achievementsQuery = `
      SELECT id, title, date, type
      FROM achievements
      WHERE employee_id = ?
    `;
    const feedbackQuery = `
      SELECT id AS feedback_id, source, comment, timestamp
      FROM feedback
      WHERE employee_id = ?
    `;
    const learningGrowthQuery = `
      SELECT id AS learning_id, title, progress, completed
      FROM learning_progress
      WHERE employee_id = ?
    `;
    const appraisalsQuery = `
      SELECT id AS appraisal_id, performance_score, manager_comments, bonus_eligible, promotion_recommended, salary_hike_percentage, reviewer_id, created_at
      FROM appraisals
      WHERE employee_id = ?
    `;
    const bonusesQuery = `
      SELECT id, bonus_type, amount, effective_date, remarks, created_at
      FROM bonuses
      WHERE employee_id = ?
    `;

    const [goals, tasks, competencies, achievements, feedback, learningGrowth, appraisals, bonuses] = await Promise.all([
      queryAsync(goalsQuery, [employee_id]),
      queryAsync(tasksQuery, [employee_id]),
      queryAsync(competenciesQuery, [employee_id]),
      queryAsync(achievementsQuery, [employee_id]),
      queryAsync(feedbackQuery, [employee_id]),
      queryAsync(learningGrowthQuery, [employee_id]),
      queryAsync(appraisalsQuery, [employee_id]),
      queryAsync(bonusesQuery, [employee_id]),
    ]);

    const goalsWithTasks = goals.map((goal) => ({
      ...goal,
      tasks: tasks.filter((task) => task.goal_id === goal.id),
    }));

    console.log("fetchEmployeePerformance - Fetched data:", {
      goals: goalsWithTasks,
      tasks,
      competencies,
      achievements,
      feedback,
      learningGrowth,
      appraisals,
      bonuses,
    });

    return res.status(200).json({
      message: "Performance data fetched successfully",
      data: {
        employee_id: employee.employee_id,
        full_name: employee.full_name,
        department_name: employee.department_name,
        goals: goalsWithTasks,
        tasks,
        competencies,
        achievements,
        feedback,
        learningGrowth,
        appraisals,
        bonuses,
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
      "INSERT INTO feedback (employee_id, source, comment, timestamp) VALUES (?, ?, ?, NOW())",
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
    new_designation_name,
    new_department_name,
    salary_hike_percentage,
    basic_salary,
    hra_percentage,
    hra,
    special_allowances,
    provident_fund_percentage,
    esic_percentage,
    bonus,
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
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const employee = await checkEmployeeExists(employee_id);
      if (!employee) {
        throw new Error(`Employee ${employee_id} not found`);
      }

      const reviewer = await checkEmployeeExists(effective_reviewer_id);
      if (!reviewer) {
        throw new Error(`Reviewer ${effective_reviewer_id} not found`);
      }

      let old_designation_name = employee.designation_name;
      let old_department_name = employee.department_name;
      if (promotion_recommended) {
        if (!new_designation_name || !new_department_name) {
          throw new Error("New designation and department are required for promotion");
        }
        const designationRows = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM designations WHERE designation_name = ? AND department_name = ?",
            [new_designation_name, new_department_name],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
        if (designationRows.length === 0) {
          throw new Error("Invalid designation or department");
        }
      }

      let new_salary_structure_id = null;
      if (salary_hike_percentage || promotion_recommended || bonus) {
        const missingFields = [];
        if (!basic_salary) missingFields.push("basic_salary");
        if (!hra_percentage) missingFields.push("hra_percentage");
        if (!hra) missingFields.push("hra");
        if (!special_allowances) missingFields.push("special_allowances");
        if (!provident_fund_percentage) missingFields.push("provident_fund_percentage");
        if (!esic_percentage) missingFields.push("esic_percentage");

        if (missingFields.length > 0) {
          throw new Error(`Missing required salary fields: ${missingFields.join(", ")}`);
        }

        if (isNaN(basic_salary) || basic_salary <= 0) {
          throw new Error("Basic salary must be a positive number");
        }
        if (isNaN(hra_percentage) || hra_percentage < 0 || hra_percentage > 100) {
          throw new Error("HRA percentage must be between 0 and 100");
        }
        if (isNaN(special_allowances) || special_allowances < 0) {
          throw new Error("Special allowances must be a non-negative number");
        }
        if (isNaN(provident_fund_percentage) || provident_fund_percentage < 0) {
          throw new Error("Provident fund percentage must be non-negative");
        }
        if (bonus && (isNaN(bonus) || bonus < 0)) {
          throw new Error("Bonus must be a non-negative number");
        }

        const gross_salary = parseFloat(basic_salary) + parseFloat(hra) + parseFloat(special_allowances) + parseFloat(bonus || 0);
        let calculatedPf = parseFloat(basic_salary) * (parseFloat(provident_fund_percentage) / 100);
        let calculatedEsi = 0;

        if (basic_salary <= 15000 && parseFloat(provident_fund_percentage) !== 12) {
          throw new Error("PF percentage must be 12% for basic salary ≤ ₹15,000");
        }
        if (gross_salary <= 21000) {
          if (parseFloat(esic_percentage) !== 0.75) {
            throw new Error("ESI percentage must be 0.75% for gross salary ≤ ₹21,000");
          }
          calculatedEsi = gross_salary * 0.0075;
        } else if (esic_percentage > 0) {
          throw new Error("ESI not applicable for gross salary > ₹21,000");
        }

        const currentSalaryRows = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT id FROM employee_salary_structure WHERE employee_id = ? AND status = 'active'",
            [employee_id],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
        const old_salary_structure_id = currentSalaryRows.length > 0 ? currentSalaryRows[0].id : null;

        const salaryQuery = `
          INSERT INTO employee_salary_structure (
            employee_id, basic_salary, hra_percentage, hra, special_allowances,
            provident_fund_percentage, provident_fund, esic_percentage, esic, bonus, status, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const salaryValues = [
          employee_id,
          parseFloat(basic_salary),
          parseFloat(hra_percentage),
          parseFloat(hra),
          parseFloat(special_allowances),
          parseFloat(provident_fund_percentage),
          calculatedPf,
          parseFloat(esic_percentage),
          calculatedEsi,
          parseFloat(bonus || 0),
          "active",
          effective_reviewer_id,
        ];
        const salaryResult = await new Promise((resolve, reject) => {
          connection.query(salaryQuery, salaryValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        new_salary_structure_id = salaryResult.insertId;

        if (old_salary_structure_id) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE employee_salary_structure SET status = 'inactive' WHERE id = ?",
              [old_salary_structure_id],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
        }

        const salaryHistoryQuery = `
          INSERT INTO salary_history (
            employee_id, old_salary_structure_id, new_salary_structure_id, effective_date, remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        const salaryHistoryValues = [
          employee_id,
          old_salary_structure_id,
          new_salary_structure_id,
          new Date().toISOString().split("T")[0],
          `Salary updated due to ${promotion_recommended ? "promotion, " : ""}${salaryHike ? "hike of " + salaryHike + "%, " : ""}${bonus ? "bonus of ₹" + bonus : ""}`,
          effective_reviewer_id,
        ];
        await new Promise((resolve, reject) => {
          connection.query(salaryHistoryQuery, salaryHistoryValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      }

      if (promotion_recommended) {
        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE hrms_users SET designation_name = ?, department_name = ? WHERE employee_id = ?",
            [new_designation_name, new_department_name, employee_id],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        const promotionQuery = `
          INSERT INTO promotion_history (
            employee_id, old_designation_name, new_designation_name, old_department_name, new_department_name,
            promotion_date, remarks, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const promotionValues = [
          employee_id,
          old_designation_name,
          new_designation_name,
          old_department_name,
          new_department_name,
          new Date().toISOString().split("T")[0],
          `Promoted during appraisal with performance score ${score}`,
          effective_reviewer_id,
        ];
        await new Promise((resolve, reject) => {
          connection.query(promotionQuery, promotionValues, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
      }

      const appraisalQuery = `
        INSERT INTO appraisals (
          employee_id, performance_score, manager_comments, bonus_eligible,
          promotion_recommended, salary_hike_percentage, reviewer_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      await new Promise((resolve, reject) => {
        connection.query(
          appraisalQuery,
          [employee_id, score, manager_comments, !!bonus_eligible, !!promotion_recommended, salaryHike, effective_reviewer_id],
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
      });

      if (manager_comments) {
        await new Promise((resolve, reject) => {
          connection.query(
            "INSERT INTO feedback (employee_id, source, comment, timestamp) VALUES (?, ?, ?, NOW())",
            [employee_id, "Manager", manager_comments],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
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
          await new Promise((resolve, reject) => {
            connection.query(
              "INSERT INTO competencies (employee_id, skill, manager_rating, feedback) VALUES (?, ?, ?, ?)",
              [employee_id, comp.skill, rating, comp.feedback || ""],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
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
          await new Promise((resolve, reject) => {
            connection.query(
              "INSERT INTO achievements (employee_id, title, date, type) VALUES (?, ?, ?, ?)",
              [employee_id, ach.title, ach.date, ach.type || "Achievement"],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
        }
      }

      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.status(201).json({
        message: "Appraisal conducted successfully",
        data: {
          employee_id,
          performance_score: score,
          promotion_recommended,
          new_designation_name: promotion_recommended ? new_designation_name : null,
          new_department_name: promotion_recommended ? new_department_name : null,
          salary_hike_percentage: salaryHike,
          salary_structure_id: new_salary_structure_id,
        },
      });
    } catch (error) {
      await new Promise((resolve, reject) => {
        connection.rollback(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      throw error;
    } finally {
      connection.release();
    }
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
    const results = await queryAsync(
      "SELECT id, employee_id, created_by FROM goals WHERE id = ?",
      [goal_id]
    );
    const goal = results[0];
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
      const employee = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ?",
        [goal.employee_id]
      );
      const user = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = 'dept_head'",
        [req.user.employee_id]
      );
      if (
        !employee[0] ||
        !user[0] ||
        employee[0].department_name !== user[0].department_name
      ) {
        return res.status(403).json({
          error: "Department heads can only update their own goals or goals of employees in their department",
        });
      }
    }

    await queryAsync(
      "UPDATE goals SET progress = ?, status = ?, updated_at = NOW() WHERE id = ?",
      [progressNum, status, goal_id]
    );

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

const awardBonus = async (req, res) => {
  const userRole = req.user.role;
  const { employee_id, bonus_type, amount, effective_date, remarks } = req.body;
  const created_by = req.user.employee_id;

  if (userRole !== "super_admin") {
    return res.status(403).json({ error: "Access denied: Only super_admin can award bonuses" });
  }

  if (!employee_id || !bonus_type || !amount || !effective_date) {
    return res.status(400).json({ error: "Employee ID, bonus type, amount, and effective date are required" });
  }

  if (!["one_time", "recurring"].includes(bonus_type)) {
    return res.status(400).json({ error: "Bonus type must be 'one_time' or 'recurring'" });
  }

  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "Bonus amount must be a positive number" });
  }

  if (isNaN(Date.parse(effective_date))) {
    return res.status(400).json({ error: "Invalid effective date format" });
  }

  try {
    const connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const employee = await checkEmployeeExists(employee_id);
      if (!employee) {
        throw new Error(`Employee ${employee_id} not found`);
      }

      const bonusQuery = `
        INSERT INTO bonuses (employee_id, bonus_type, amount, effective_date, remarks, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;
      const bonusResult = await new Promise((resolve, reject) => {
        connection.query(bonusQuery, [employee_id, bonus_type, parseFloat(amount), effective_date, remarks || `${bonus_type === "one_time" ? "One-time" : "Recurring"} bonus awarded`, created_by], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.status(201).json({
        message: `${bonus_type === "one_time" ? "One-time" : "Recurring"} bonus awarded successfully`,
        data: {
          id: bonusResult.insertId,
          employee_id,
          bonus_type,
          amount: parseFloat(amount),
          effective_date,
          remarks,
        },
      });
    } catch (error) {
      await new Promise((resolve, reject) => {
        connection.rollback(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      throw error;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("awardBonus - Database error:", {
      error: err.message,
      employee_id,
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
  awardBonus,
};