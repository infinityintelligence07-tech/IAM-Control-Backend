import { Controller, Get, Query, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { PolosService } from './polos.service';
import { GetPolosDto, PolosListResponseDto, PoloResponseDto } from './dto/polos.dto';

@Controller('polos')
@UseInterceptors(ClassSerializerInterceptor)
export class PolosController {
  constructor(private readonly polosService: PolosService) {}

  @Get()
  async findAll(@Query() filters: GetPolosDto): Promise<PolosListResponseDto> {
    console.log('Buscando polos com filtros:', filters);
    return this.polosService.findAll(filters);
  }

  @Get('grouped')
  async findAllGrouped(): Promise<any> {
    console.log('Buscando polos agrupados');
    return this.polosService.findAllGrouped();
  }

  @Get(':id')
  async findById(@Query('id') id: number): Promise<PoloResponseDto | null> {
    console.log('Buscando polo por ID:', id);
    return this.polosService.findById(id);
  }
}
