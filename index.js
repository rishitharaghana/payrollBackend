const express = require("express");
const cors = require("cors");
const app = express();
const authRouter = require("./routes/authRoutes");
const userRouter = require('./routes/userRoutes');
const employeeRouter = require('./routes/employeeRoutes');
const departmentRouter = require('./routes/departmentRoutes');
const attendanceRouter = require('./routes/attendanceRoutes');
const leaveRouter = require('./routes/leaveRoutes');
const payrollRouter = require('./routes/payrollRoutes');
const deptHeadRouter = require('./routes/deptHeadRoutes');
const hrRouter = require('./routes/hrRoutes')


app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello world");
});

app.use("/api", authRouter);
app.use('/api', userRouter);
app.use('/api', employeeRouter);
app.use('/api', departmentRouter);
app.use('/api', attendanceRouter);
app.use('/api', leaveRouter);
app.use('/api', payrollRouter);
app.use('/api', deptHeadRouter);
app.use('/api', hrRouter)

const port = 3007;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
