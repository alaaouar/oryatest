import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ParentSpaceModule } from "../parent-space/parent-space.module";
import { AttendanceReminderJob } from "./attendance-reminder.job";
import { AttendanceReminderService } from "./attendance-reminder.service";
import { AssignmentsController } from "./assignments.controller";
import { AssignmentsService } from "./assignments.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { ClassroomsController, TeachersController } from "./directory.controller";
import { DirectoryService } from "./directory.service";

@Module({
  imports: [AuditModule, ParentSpaceModule],
  controllers: [AssignmentsController, AttendanceController, ClassroomsController, TeachersController],
  providers: [AssignmentsService, AttendanceService, DirectoryService, AttendanceReminderService, AttendanceReminderJob],
})
export class AttendanceModule {}