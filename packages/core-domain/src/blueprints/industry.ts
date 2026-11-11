/** 工业软件组 15 条条目的起盘蓝图：编码 cat.industry-01 ~ cat.industry-15。 */
import { B, type ModuleBlueprint } from './types.js'; // 蓝图构造函数与类型

export const INDUSTRY_BLUEPRINTS: readonly ModuleBlueprint[] = [ // 数组顺序即分类树顺序
  // 01 智能硬件：ESP32 固件骨架
  B('cat.industry-01', '智能硬件：ESP32 固件骨架——串口初始化 + WiFi 连接 + 周期上报。', 'C++ / Arduino / ESP32', "#include <WiFi.h>\nvoid setup() { Serial.begin(115200); WiFi.begin(\"SSID\", \"PASS\"); }\nvoid loop() { if (WiFi.status() == WL_CONNECTED) { Serial.println(WiFi.localIP()); } delay(5000); }"),
  // 02 IOT/边缘计算：EMQX 规则引擎
  B('cat.industry-02', 'IOT/物联网/边缘计算：EMQX 规则——按温度阈值筛选并转发告警 webhook。', 'EMQX / SQL', "# EMQX 规则：温度超阈值转发告警\nSELECT payload.temp as temp, clientid FROM 'sensors/#' WHERE payload.temp > 35\n# 动作：webhook 到 https://mim.mixm.top/api/v1/alerts"),
  // 03 车载应用：CarAppService 声明
  B('cat.industry-03', '车载应用：Android Automotive CarAppService 声明与会话创建入口。', 'Kotlin / Android Automotive', "<!-- AndroidManifest.xml -->\n<service android:name=\".MimCarAppService\" android:exported=\"true\">\n  <intent-filter><action android:name=\"androidx.car.app.CarAppService\"/></intent-filter>\n</service>\n<!-- 实现 createHostValidator() 与 onCreateSession()，用 CarAppSession 渲染模板 -->"),
  // 04 车载系统：DBC 信号定义
  B('cat.industry-04', '车载系统：CAN 总线 DBC 信号定义与 cantools 解析口径。', 'CAN / DBC / cantools', "BO_ 256 VCU_Status: 8 VCU\n SG_ VehicleSpeed : 0|16@1+ (0.1,0) [0|250] \"km/h\" ECU\n SG_ Soc : 16|8@1+ (0.5,0) [0|100] \"%\" BMS\n# 解析：cantools.database.load_file('vcu.dbc') → db.decode_message(256, data)"),
  // 05 自动驾驶/无人机：MAVLink 起飞指令
  B('cat.industry-05', '自动驾驶/无人机：MAVLink 切换 GUIDED 模式并发送起飞指令。', 'Python / pymavlink', "from pymavlink import mavutil\nm = mavutil.mavlink_connection('udpout:127.0.0.1:14550')\nm.mav.set_mode_send(m.target_system, 1, 4)  # GUIDED\nm.mav.command_long_send(m.target_system, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0)  # NAV_TAKEOFF"),
  // 06 机器人：ROS2 节点
  B('cat.industry-06', '机器人：ROS2 节点骨架（10Hz 定时回调 + 日志输出）。', 'Python / ROS2', "import rclpy\nfrom rclpy.node import Node\nclass MimNode(Node):\n    def __init__(self):\n        super().__init__('mim_node'); self.create_timer(0.1, self.tick)\n    def tick(self): self.get_logger().info('tick')\nrclpy.init(); rclpy.spin(MimNode())"),
  // 07 5G/通讯：QoS 与切片参数
  B('cat.industry-07', '5G/通讯：QoS 5QI 选型与网络切片 SST 参数对照。', '3GPP / 网络规划', "# 5G QoS（TS 23.501）\n5QI=9   # 默认非 GBR：网页/视频\n5QI=1   # 会话语音（GBR）\n# 切片：SST=1 eMBB / SST=2 URLLC / SST=3 mMTC"),
  // 08 芯片开发：Verilog 计数器 + 时序约束
  B('cat.industry-08', '芯片开发：Verilog 同步计数器与时钟约束文件。', 'Verilog / SDC', "module mim_counter (input clk, input rst_n, output reg [7:0] cnt);\nalways @(posedge clk or negedge rst_n) begin\n  if (!rst_n) cnt <= 8'd0; else cnt <= cnt + 8'd1;\nend\nendmodule\n// 约束：create_clock -period 10 [get_ports clk]"),
  // 09 隐私计算：同态加密 + PSI 口径
  B('cat.industry-09', '隐私计算：同态加密加权计算 + PSI 交集口径（原始样本不出域）。', 'Python / TenSEAL', "from tenseal import Context, CKKSVector\nctx = Context.contextFromFile('ckks.pub')\nenc = CKKSVector(ctx, [0.12, 0.31]); enc *= 3.0  # 同态加权\n# PSI：RSA 盲签名求交集，双方只拿到交集哈希"),
  // 10 工程软件：IFC 模型读写
  B('cat.industry-10', '工程软件：IFC 构件与空间关系读写（ifcopenshell 遍历墙体）。', 'IFC / Python', "import ifcopenshell\nmodel = ifcopenshell.open('model.ifc')\nfor wall in model.by_type('IfcWall'):\n    print(wall.GlobalId, wall.Name)\n# 新增：IFCRELCONTAINEDINSPATIALSTRUCTURE 建立墙与楼层的归属"),
  // 11 CAD：DXF 图层与多段线
  B('cat.industry-11', 'CAD：ezdxf 新建图层并绘制闭合多段线，输出可交付 DXF。', 'Python / ezdxf', "import ezdxf\ndoc = ezdxf.new('R2010')\ndoc.layers.add('MIM-WALL', color=3)\nmsp = doc.modelspace()\nmsp.add_lwpolyline([(0, 0), (1200, 0), (1200, 800), (0, 800)], close=True, dxfattribs={'layer': 'MIM-WALL'})\ndoc.saveas('plan.dxf')"),
  // 12 CAE：OpenFOAM 求解设置
  B('cat.industry-12', 'CAE：OpenFOAM 算例目录与 controlDict 求解参数起步配置。', 'OpenFOAM', "# case 结构：0/ constant/ system/\n# system/controlDict\napplication icoFoam; endTime 2; deltaT 0.005; writeInterval 0.5;\n# 流程：blockMesh → checkMesh → icoFoam → postProcess"),
  // 13 MBSE：SysML 需求追溯
  B('cat.industry-13', 'MBSE：SysML 需求定义与 satisfy 追溯关系（需求-实现一一对应）。', 'SysML', "package MimSystem {\n  requirement R1 { id = \"REQ-001\"; text = \"商城支持购物车结算\"; }\n  part cart : Cart;\n  satisfy requirement R1 by cart;  // 需求-实现追溯\n}"),
  // 14 CAM：铣削参数与工序单
  B('cat.industry-14', 'CAM：铝合金铣削参数表与工序单（含仿真碰撞检查环节）。', 'CAM / G 代码', "# 铣削参数（铝合金 6061）\nspindle_rpm: 12000\ntool: D6 平底刀\nfeed_mm_min: 900\nstepover_mm: 3.0\ndepth_per_pass_mm: 2.0\n# 工序：STEP → 刀路 → 仿真 → G21 G90 G54 后处理"),
  // 15 EDA：时序约束 SDC
  B('cat.industry-15', 'EDA：SDC 时序约束（时钟、输入输出延迟、异步复位例外）。', 'SDC / 综合', "create_clock -name core_clk -period 10 [get_ports clk]\nset_input_delay -clock core_clk 2 [all_inputs]\nset_output_delay -clock core_clk 2 [all_outputs]\nset_false_path -from [get_ports rst_n]\n# 报告：report_timing -max_paths 20 -slack_lesser_than 0"),
]; // 工业软件蓝图结束：15 条
