const express = require("express");
const cors = require("cors");
const app = express();
const path = require('path');
const upload = require('./middleware/upload');
const authRouter = require("./routes/authRoutes");
const employeeRouter = require('./routes/employeeRoutes');
const departmentRouter = require('./routes/departmentRoutes');
const attendanceRouter = require('./routes/attendanceRoutes');
const leaveRouter = require('./routes/leaveRoutes');
const payrollRouter = require('./routes/payrollRoutes');
const payslipRouter  = require('./routes/payslipRoutes');
const travelExpensesRouter = require('./routes/travelExpensesRoutes');
const performanceRouter = require('./routes/performanceRoutes')
require("./config/Scheduler");

app.use(cors());
app.use(express.json());
const allowedOrigins = [
  'http://localhost:3004',
 'https://fe2663e99cb4.ngrok-free.app',
];

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const corsOptions = {
  origin: function (origin, callback) {
   
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: 'GET,POST,PUT,DELETE,OPTIONS',
  allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning', // Include ngrok-skip-browser-warning
  exposedHeaders: ['Content-Disposition'],
};
app.use(cors(corsOptions));
app.get("/", (req, res) => {
  res.send("Hello world");
});

app.use("/api", authRouter);
app.use('/api', employeeRouter);
app.use('/api', departmentRouter);
app.use('/api', attendanceRouter);
app.use('/api', leaveRouter);
app.use('/api', payrollRouter);
app.use('/api', payslipRouter);
app.use('/api', travelExpensesRouter);
app.use('/api', performanceRouter);

const port = 3007;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
